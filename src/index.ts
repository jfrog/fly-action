// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { authenticateOidc } from "./oidc";
import {
  INPUT_URL,
  INPUT_IGNORE_PACKAGE_MANAGERS,
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  ENV_FLY_ACTION_CONFIGURED,
  ENV_FLY_REGISTRY_SUBDOMAIN,
  DEFAULT_FLY_URL,
  ENV_FLY_URL,
} from "./constants";

/**
 * Resolves the platform-specific Fly binary path and ensures it is executable
 */
export function resolveFlyCLIBinaryPath(): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  const binName = `fly-${process.platform}-${process.arch}${ext}`;
  const binPath = path.resolve(__dirname, "..", "bin", binName);
  if (!fs.existsSync(binPath)) {
    throw new Error(
      `Fly CLI binary not found at ${binPath} for ${process.platform}/${process.arch}. Ensure it is present in the 'bin' directory of the action.`,
    );
  }
  if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);
  return binPath;
}

/**
 * Determines the Fly OIDC endpoint URL. Resolution order:
 * 1. Explicit `url` action input (deprecated but still supported)
 * 2. `CUSTOM_FLY_URL` environment variable (org-level, required for GHES)
 * 3. Default `fly.jfrog.ai` — only valid for github.com runners
 *
 * On GitHub Enterprise Server, the default endpoint cannot resolve tenants
 * because GHES installations live in a separate Fly environment. The action
 * fails fast with a clear message when neither `url` nor `CUSTOM_FLY_URL` is set.
 */
export function resolveOidcUrl(): string {
  const inputUrl = core.getInput(INPUT_URL);
  if (inputUrl) {
    core.warning(
      `The 'url' input is deprecated and will be removed in a future version. ` +
        `Remove it from your workflow — tenant is now resolved automatically from OIDC claims.`,
    );
    return inputUrl;
  }

  const envUrl = process.env[ENV_FLY_URL];
  if (envUrl) {
    core.info(`Using Fly URL from ${ENV_FLY_URL} environment variable.`);
    return envUrl;
  }

  const githubServerUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  if (githubServerUrl !== "https://github.com") {
    throw new Error(
      `GitHub Enterprise Server detected (${githubServerUrl}). ` +
        `Set the ${ENV_FLY_URL} organization variable to your Fly environment URL ` +
        `(e.g., "https://fly.jfrog.info" for staging). ` +
        `The default ${DEFAULT_FLY_URL} only resolves tenants for github.com.`,
    );
  }

  return DEFAULT_FLY_URL;
}

export async function run(): Promise<void> {
  core.info("Main run() function started.");

  // Idempotency check: skip if action has already run in this job
  if (process.env[ENV_FLY_ACTION_CONFIGURED] === "true") {
    core.info(
      "Fly action has already been configured in this job, skipping duplicate run.",
    );
    return;
  }

  try {
    const oidcUrl = resolveOidcUrl();
    core.info(`URL for OIDC: ${oidcUrl}`);
    const ignorePackageManagers = core.getInput(INPUT_IGNORE_PACKAGE_MANAGERS);
    core.info(`Ignore Package Managers: ${ignorePackageManagers || "none"}`);

    core.info("Attempting OIDC authentication...");
    const { accessToken, flyTenantUrl } = await authenticateOidc(oidcUrl);
    core.info(`OIDC authentication successful.`);
    core.setSecret(accessToken);

    core.info(`Fly tenant URL: ${flyTenantUrl}`);

    // Export the hostname without protocol so it's directly usable in Docker
    // image names, Helm OCI refs, etc. Users add their own prefix as needed:
    //   Docker: $FLY_REGISTRY_SUBDOMAIN/docker/my-app:tag
    //   Helm:   oci://$FLY_REGISTRY_SUBDOMAIN/helmoci
    const registryHost = flyTenantUrl.replace(/^https?:\/\//, "");
    core.exportVariable(ENV_FLY_REGISTRY_SUBDOMAIN, registryHost);

    core.saveState(STATE_FLY_URL, flyTenantUrl);
    core.saveState(STATE_FLY_ACCESS_TOKEN, accessToken);
    core.info("State saved for post-job notification.");

    const binPath = resolveFlyCLIBinaryPath();
    core.info(`CLI binary path: ${binPath}`);
    const envVars: Record<string, string> = {
      FLY_URL: flyTenantUrl,
      FLY_ACCESS_TOKEN: accessToken,
      FLY_IGNORE_PACKAGE_MANAGERS: ignorePackageManagers,
    };

    const options = {
      env: { ...process.env, ...envVars } as Record<string, string>,
    };

    // Run fly-client setup (fly-client will configure all package managers)
    core.info("Executing Fly CLI setup");
    const args = ["setup"];
    const exitCode = await exec.exec(binPath, args, options);

    if (exitCode !== 0) {
      core.error("Fly setup command failed with non-zero exit code.");
      throw new Error("Fly setup command failed");
    }
    core.info("Fly CLI setup command completed successfully.");

    // Mark action as configured to prevent duplicate runs in same job
    core.exportVariable(ENV_FLY_ACTION_CONFIGURED, "true");
    core.info("Marked Fly action as configured for this job.");
  } catch (error) {
    core.error("Error occurred during execution.");

    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed("An unknown error occurred");
  }
}

if (require.main === module) {
  run();
}

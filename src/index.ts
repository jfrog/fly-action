// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { authenticateOidc } from "./oidc";
import { downloadFlyCLI, getBinaryName } from "./fly-cli";
import {
  INPUT_URL,
  INPUT_IGNORE_PACKAGE_MANAGERS,
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  ENV_FLY_ACTION_CONFIGURED,
  ENV_FLY_REGISTRY_SUBDOMAIN,
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
  ENV_FLY_IGNORE_PACKAGE_MANAGERS,
  DEFAULT_FLY_URL,
  ENV_FLY_URL,
  CLI_CMD_SETUP,
  STATE_FLY_PLATFORM_URL,
} from "./constants";
import { getErrorMessage } from "./utils";
import { executeWithRetry, isTransientProcessError } from "./retry";

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
/**
 * Validates that a Fly URL uses HTTPS. Rejects plaintext HTTP to prevent
 * OIDC token exfiltration via a compromised GITHUB_ENV variable.
 */
function validateFlyUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid Fly URL: "${url}" is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Invalid Fly URL: "${url}" must use HTTPS. ` +
        `Sending OIDC tokens over plaintext HTTP is not supported.`,
    );
  }
}

export function resolveOidcUrl(): string {
  const inputUrl = core.getInput(INPUT_URL);
  if (inputUrl) {
    validateFlyUrl(inputUrl);
    core.warning(
      `The 'url' input is deprecated and will be removed in a future version. ` +
        `Remove it from your workflow — tenant is now resolved automatically from OIDC claims.`,
    );
    return inputUrl;
  }

  const envUrl = process.env[ENV_FLY_URL];
  if (envUrl) {
    validateFlyUrl(envUrl);
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

    const registryHost = flyTenantUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
    core.exportVariable(ENV_FLY_REGISTRY_SUBDOMAIN, registryHost);

    // Export credentials to GITHUB_ENV so sub-actions (upload/download)
    // and user run: steps can use the fly CLI.
    core.exportVariable(ENV_FLY_URL_RUNTIME, flyTenantUrl);
    core.exportVariable(ENV_FLY_ACCESS_TOKEN_RUNTIME, accessToken);

    core.saveState(STATE_FLY_URL, flyTenantUrl);
    core.saveState(STATE_FLY_ACCESS_TOKEN, accessToken);
    core.saveState(STATE_FLY_PLATFORM_URL, oidcUrl);
    core.info("State saved for post-job notification.");

    const binDir = await downloadFlyCLI();
    const binPath = path.join(binDir, getBinaryName());
    core.info(`CLI binary path: ${binPath}`);

    // Pass env vars inline for the setup call — exportVariable writes to
    // GITHUB_ENV which only takes effect in subsequent steps, not this one.
    const envVars: Record<string, string> = {
      [ENV_FLY_URL_RUNTIME]: flyTenantUrl,
      [ENV_FLY_ACCESS_TOKEN_RUNTIME]: accessToken,
      [ENV_FLY_IGNORE_PACKAGE_MANAGERS]: ignorePackageManagers,
    };

    const options = {
      env: { ...process.env, ...envVars } as Record<string, string>,
    };

    core.info("Executing Fly CLI setup");
    const args = [CLI_CMD_SETUP];
    await executeWithRetry(
      async () => {
        let stderr = "";
        const execOptions: exec.ExecOptions = {
          ...options,
          ignoreReturnCode: true,
          listeners: {
            stderr: (data: Buffer) => {
              stderr += data.toString();
            },
          },
        };
        const exitCode = await exec.exec(binPath, args, execOptions);
        if (exitCode !== 0) {
          throw new Error(
            `Fly setup failed (exit ${exitCode}): ${stderr.trim() || "no stderr"}`,
          );
        }
      },
      {
        isRetryable: (err) => isTransientProcessError(err.message),
        maxAttempts: 3,
        initialDelayMs: 5000,
        label: "fly setup",
      },
    );
    core.info("Fly CLI setup command completed successfully.");

    // Mark action as configured to prevent duplicate runs in same job
    core.exportVariable(ENV_FLY_ACTION_CONFIGURED, "true");
    core.info("Marked Fly action as configured for this job.");
  } catch (error) {
    core.error("Error occurred during execution.");

    core.setFailed(getErrorMessage(error));
  }
}

if (require.main === module) {
  run();
}

// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { authenticateOidc } from "./oidc";
import { detectPackageManagers } from "./package-detection";
import {
  INPUT_URL,
  INPUT_IGNORE_PACKAGE_MANAGERS,
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PACKAGE_MANAGERS,
  ENV_FLY_ACTION_CONFIGURED,
  DEFAULT_FLY_URL,
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
    const inputUrl = core.getInput(INPUT_URL);
    const oidcUrl = inputUrl || DEFAULT_FLY_URL;
    if (inputUrl) {
      core.warning(
        `The 'url' input is deprecated and will be removed in a future version. ` +
        `Remove it from your workflow — tenant is now resolved automatically from OIDC claims.`,
      );
    }
    core.info(`URL for OIDC: ${oidcUrl}`);
    const ignorePackageManagers = core.getInput(INPUT_IGNORE_PACKAGE_MANAGERS);
    core.info(`Ignore Package Managers: ${ignorePackageManagers || "none"}`);

    core.info("Attempting OIDC authentication...");
    const { accessToken, flyTenantUrl } = await authenticateOidc(oidcUrl);
    core.info(`OIDC authentication successful.`);
    core.setSecret(accessToken);

    core.info(`Fly tenant URL: ${flyTenantUrl}`);

    core.saveState(STATE_FLY_URL, flyTenantUrl);
    core.saveState(STATE_FLY_ACCESS_TOKEN, accessToken);
    core.info("State saved for post-job notification.");

    // Detect package managers for EndCI reporting
    const workspacePath = process.env.GITHUB_WORKSPACE || "";
    const detectedPackageManagers = detectPackageManagers(workspacePath);
    core.saveState(
      STATE_FLY_PACKAGE_MANAGERS,
      JSON.stringify(detectedPackageManagers),
    );
    core.info(
      `Detected package managers for EndCI: ${JSON.stringify(detectedPackageManagers)}`,
    );

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

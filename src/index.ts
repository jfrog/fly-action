// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { authenticateOidc } from "./oidc";
import { detectPackageManagers } from "./package-detection"; // Import from new file
import {
  INPUT_URL,
  INPUT_IGNORE_PACKAGE_MANAGERS,
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PACKAGE_MANAGERS,
} from "./constants";

/**
 * Resolves the platform-specific Fly binary path and ensures it is executable
 */
export function resolveFlyCLIBinaryPath(): string {
  const binName = `fly-${process.platform}-${process.arch}`;
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
  try {
    const url = core.getInput(INPUT_URL, { required: true });
    core.info(`URL: ${url}`);
    const ignorePackageManagers = core.getInput(INPUT_IGNORE_PACKAGE_MANAGERS);
    core.info(`Ignore Package Managers: ${ignorePackageManagers || "none"}`);

    core.info("Attempting OIDC authentication...");
    const { accessToken } = await authenticateOidc(url);
    core.info(`OIDC authentication successful.`);
    core.setSecret(accessToken);

    // Save URL and access token to state for post-job CI end notification
    core.saveState(STATE_FLY_URL, url);
    core.saveState(STATE_FLY_ACCESS_TOKEN, accessToken);
    core.info("State saved for post-job notification.");

    // Detect and save package managers
    const workspacePath = process.env.GITHUB_WORKSPACE || "";
    const detectedPackageManagers = await detectPackageManagers(workspacePath);
    core.saveState(
      STATE_FLY_PACKAGE_MANAGERS,
      JSON.stringify(detectedPackageManagers),
    );
    core.info(
      `Saved detected package managers to state: ${JSON.stringify(detectedPackageManagers)}`,
    );

    const binPath = resolveFlyCLIBinaryPath();
    core.info(`CLI binary path: ${binPath}`);
    const envVars: Record<string, string> = {
      FLY_URL: url,
      FLY_ACCESS_TOKEN: accessToken,
      FLY_IGNORE_PACKAGE_MANAGERS: ignorePackageManagers,
    };

    const options = {
      env: { ...process.env, ...envVars } as Record<string, string>,
    };

    // Pass detected managers to fly-client for optimized parallel execution
    let exitCode: number;
    if (detectedPackageManagers.length > 0) {
      core.info(
        `Executing Fly CLI setup for detected managers: ${detectedPackageManagers.join(", ")}`,
      );
      const args = ["setup", ...detectedPackageManagers];
      exitCode = await exec.exec(binPath, args, options);
    } else {
      // Fallback: Let fly-client detect and configure all available
      core.info(
        "No package managers detected, letting Fly CLI detect and configure all available...",
      );
      exitCode = await exec.exec(binPath, ["setup"], options);
    }

    if (exitCode !== 0) {
      core.error("Fly setup command failed with non-zero exit code.");
      throw new Error("Fly setup command failed");
    }
    core.info("Fly CLI setup command completed successfully.");
  } catch (error) {
    core.error("Error occurred during execution.");

    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed("An unknown error occurred");
  }
}

if (require.main === module) {
  run();
}

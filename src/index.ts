import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { authenticateOidc } from "./oidc";
import { detectPackageManagers } from "./package-detection"; // Import from new file
import {
  INPUT_URL,
  INPUT_IGNORE_PACKAGE_MANAGERS,
  STATE_FLYFROG_URL,
  STATE_FLYFROG_ACCESS_TOKEN,
  STATE_FLYFROG_PACKAGE_MANAGERS,
} from "./constants";

/**
 * Resolves the platform-specific FlyFrog binary path and ensures it is executable
 */
export function resolveFlyFrogCLIBinaryPath(): string {
  const binName = `flyfrog-${process.platform}-${process.arch}`;
  const binPath = path.resolve(__dirname, "..", "bin", binName);
  if (!fs.existsSync(binPath)) {
    throw new Error(
      `FlyFrog CLI binary not found at ${binPath} for ${process.platform}/${process.arch}. Ensure it is present in the 'bin' directory of the action.`,
    );
  }
  if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);
  return binPath;
}

export async function run(): Promise<void> {
  core.info("FlyFrog Action: Main run() function started.");
  try {
    const url = core.getInput(INPUT_URL, { required: true });
    core.info(`FlyFrog Action: URL: ${url}`);
    const ignorePackageManagers = core.getInput(INPUT_IGNORE_PACKAGE_MANAGERS);
    core.info(
      `FlyFrog Action: Ignore Package Managers: ${ignorePackageManagers || "none"}`,
    );

    core.info("FlyFrog Action: Attempting OIDC authentication...");
    const { accessToken } = await authenticateOidc(url);
    core.info(`FlyFrog Action: OIDC authentication successful.`);
    core.setSecret(accessToken);

    // Save URL and access token to state for post-job CI end notification
    core.saveState(STATE_FLYFROG_URL, url);
    core.saveState(STATE_FLYFROG_ACCESS_TOKEN, accessToken);
    core.info("FlyFrog Action: State saved for post-job notification.");

    // Detect and save package managers
    const workspacePath = process.env.GITHUB_WORKSPACE || "";
    const detectedPackageManagers = detectPackageManagers(workspacePath);
    core.saveState(
      STATE_FLYFROG_PACKAGE_MANAGERS,
      JSON.stringify(detectedPackageManagers),
    );
    core.info(
      `FlyFrog Action: Saved detected package managers to state: ${JSON.stringify(detectedPackageManagers)}`,
    );

    const binPath = resolveFlyFrogCLIBinaryPath();
    core.info(`FlyFrog Action: CLI binary path: ${binPath}`);
    const envVars: Record<string, string> = {
      FLYFROG_URL: url,
      FLYFROG_ACCESS_TOKEN: accessToken,
      FLYFROG_IGNORE_PACKAGE_MANAGERS: ignorePackageManagers,
    };

    const options = {
      env: { ...process.env, ...envVars } as Record<string, string>,
    };
    core.info("FlyFrog Action: Executing FlyFrog CLI setup command...");
    const exitCode = await exec.exec(binPath, ["setup"], options);
    if (exitCode !== 0) {
      core.error(
        "FlyFrog Action: FlyFrog setup command failed with non-zero exit code.",
      );
      throw new Error("FlyFrog setup command failed");
    }
    core.info(
      "FlyFrog Action: FlyFrog CLI setup command completed successfully.",
    );
  } catch (error) {
    core.error("FlyFrog Action: Error occurred during execution.");
    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed("An unknown error occurred");
  }
}

if (require.main === module) {
  run();
}

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { authenticateOidc } from "./oidc";
import {
  INPUT_URL,
  INPUT_IGNORE_PACKAGE_MANAGERS,
  STATE_FLYFROG_URL,
  STATE_FLYFROG_ACCESS_TOKEN,
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
  core.notice("FlyFrog Action: Main run() function started.");
  try {
    const url = core.getInput(INPUT_URL, { required: true });
    core.notice(`FlyFrog Action: URL: ${url}`);
    const ignorePackageManagers = core.getInput(INPUT_IGNORE_PACKAGE_MANAGERS);
    core.notice(
      `FlyFrog Action: Ignore Package Managers: ${ignorePackageManagers || "none"}`,
    );

    core.notice("FlyFrog Action: Attempting OIDC authentication...");
    const { user, accessToken } = await authenticateOidc(url);
    core.notice(`FlyFrog Action: OIDC authentication successful. User: ${user}`);
    core.setSecret(accessToken);
    core.setOutput("oidcUser", user);
    core.setOutput("oidcToken", accessToken);

    // Save URL and access token to state for post-job CI end notification
    core.saveState(STATE_FLYFROG_URL, url);
    core.saveState(STATE_FLYFROG_ACCESS_TOKEN, accessToken);
    core.notice("FlyFrog Action: State saved for post-job notification.");

    const binPath = resolveFlyFrogCLIBinaryPath();
    core.notice(`FlyFrog Action: CLI binary path: ${binPath}`);
    const envVars: Record<string, string> = {
      FLYFROG_URL: url,
      FLYFROG_USER: user,
      FLYFROG_ACCESS_TOKEN: accessToken,
      FLYFROG_IGNORE_PACKAGE_MANAGERS: ignorePackageManagers,
    };

    const options = {
      env: { ...process.env, ...envVars } as Record<string, string>,
    };
    core.notice("FlyFrog Action: Executing FlyFrog CLI setup command...");
    const exitCode = await exec.exec(binPath, ["setup"], options);
    if (exitCode !== 0) {
      core.error(
        "FlyFrog Action: FlyFrog setup command failed with non-zero exit code.",
      );
      throw new Error("FlyFrog setup command failed");
    }
    core.notice(
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

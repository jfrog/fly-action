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
  try {
    const url = core.getInput(INPUT_URL, { required: true });
    const ignorePackageManagers = core.getInput(INPUT_IGNORE_PACKAGE_MANAGERS);

    const { user, accessToken } = await authenticateOidc(url);
    core.setSecret(accessToken);

    // Save URL and access token to state for post-job CI end notification
    core.saveState(STATE_FLYFROG_URL, url);
    core.saveState(STATE_FLYFROG_ACCESS_TOKEN, accessToken);

    const binPath = resolveFlyFrogCLIBinaryPath();
    const envVars: Record<string, string> = {
      FLYFROG_URL: url,
      FLYFROG_USER: user,
      FLYFROG_ACCESS_TOKEN: accessToken,
      FLYFROG_IGNORE_PACKAGE_MANAGERS: ignorePackageManagers,
    };

    const options = {
      env: { ...process.env, ...envVars } as Record<string, string>,
    };
    const exitCode = await exec.exec(binPath, ["setup"], options);
    if (exitCode !== 0) throw new Error("FlyFrog setup command failed");
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed("An unknown error occurred");
  }
}

if (require.main === module) {
  run();
}

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { authenticateOidc } from "./oidc";

/**
 * Resolves the platform-specific FlyFrog binary path and ensures it is executable
 */
export function resolveFlyFrogCLIBinaryPath(): string {
  const binName = `flyfrog-${process.platform}-${process.arch}`;
  const binPath = path.resolve(__dirname, "..", "bin", binName);
  if (!fs.existsSync(binPath)) {
    throw new Error(`Binary not found for ${process.platform}/${process.arch}`);
  }
  if (process.platform !== "win32") fs.chmodSync(binPath, 0o755);
  return binPath;
}

export async function run(): Promise<void> {
  try {
    const url = core.getInput("url", { required: true });
    const ignorePackageManagers = core.getInput("ignore");

    const { user, accessToken } = await authenticateOidc(url);
    core.info("Successfully authenticated with OIDC");
    core.setSecret(accessToken);

    // Save URL and access token to state for post-job CI end notification
    core.saveState("flyfrog-url", url);
    core.saveState("flyfrog-access-token", accessToken);

    const binPath = resolveFlyFrogCLIBinaryPath();
    const envVars: Record<string, string> = {
      FLYFROG_URL: url,
      FLYFROG_USER: user,
      FLYFROG_ACCESS_TOKEN: accessToken,
      FLYFROG_IGNORE_PACKAGE_MANAGERS: ignorePackageManagers,
    };

    const options = {
      env: { ...process.env, ...envVars } as Record<string, string>,
      silent: true, // suppress default exec output to avoid duplicates
      listeners: {
        stdout: (data: Buffer) => core.info(data.toString()),
        stderr: (data: Buffer) => core.error(data.toString()),
      },
    };
    const exitCode = await exec.exec(binPath, ["setup"], options);
    if (exitCode !== 0) throw new Error("FlyFrog setup command failed");
    core.info("FlyFrog registry configuration completed successfully");
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed("An unknown error occurred");
  }
}

if (require.main === module) {
  run();
}

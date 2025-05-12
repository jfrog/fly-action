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
    // Get inputs
    const url = core.getInput("url", { required: true });
    const ignorePackageManagers = core.getInput("ignore");

    // Perform OIDC authentication and token exchange
    const { user, accessToken } = await authenticateOidc(url);
    core.info("Successfully authenticated with OIDC");
    core.setSecret(accessToken);

    // Resolve the FlyFrog binary path
    const flyFrogCLIBinPath = resolveFlyFrogCLIBinaryPath();

    // Set environment variables for authentication
    const envVars: Record<string, string> = {
      FLYFROG_URL: url,
      FLYFROG_USER: user,
      FLYFROG_ACCESS_TOKEN: accessToken,
      FLYFROG_IGNORE_PACKAGE_MANAGERS: ignorePackageManagers,
    };

    // Run the setup command
    core.info("Running FlyFrog setup command with environment variables");
    const options = {
      env: { ...process.env, ...envVars } as Record<string, string>,
      listeners: {
        stdout: (data: Buffer) => core.info(data.toString()),
        stderr: (data: Buffer) => core.error(data.toString()),
      },
    };
    const exitCode = await exec.exec(flyFrogCLIBinPath, ["setup"], options);
    if (exitCode !== 0) {
      throw new Error("FlyFrog setup command failed");
    }
    core.info("FlyFrog registry configuration completed successfully");
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed("An unknown error occurred");
  }
}

// Only run if this module is executed directly
if (require.main === module) {
  run();
}
// End of OIDC-based setup logic

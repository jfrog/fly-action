// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import * as path from "path";
import { authenticateOidc } from "./oidc";
import { getAllPackageManagers } from "./package-detection";
import {
  INPUT_URL,
  INPUT_IGNORE_PACKAGE_MANAGERS,
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PACKAGE_MANAGERS,
  FLY_CLIENT_BASE_URL,
} from "./constants";

const PLATFORM_MAP: Record<string, string> = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

const ARCH_MAP: Record<string, string> = {
  x64: "amd64",
  arm64: "arm64",
};

const FLY_TOOL_NAME = "fly-client";
const FLY_BINARY_NAME = "fly";
const FLY_CACHE_VERSION = "latest";

/**
 * Maps Node.js platform/arch to Fly client URL format
 */
function getPlatformInfo(): { os: string; arch: string; extension: string } {
  const os = PLATFORM_MAP[process.platform];
  if (!os) {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  const arch = ARCH_MAP[process.arch];
  if (!arch) {
    throw new Error(`Unsupported architecture: ${process.arch}`);
  }

  const extension = process.platform === "win32" ? ".exe" : "";

  return { os, arch, extension };
}

/**
 * Checks if fly-client is already cached
 * @returns Path to binary if found, null otherwise
 */
function findCachedBinary(
  os: string,
  arch: string,
  extension: string,
): string | null {
  const cachedPath = tc.find(FLY_TOOL_NAME, FLY_CACHE_VERSION, `${os}-${arch}`);

  if (!cachedPath) {
    return null;
  }

  const binPath = path.join(cachedPath, `${FLY_BINARY_NAME}${extension}`);
  if (fs.existsSync(binPath)) {
    core.info(`Found cached ${FLY_TOOL_NAME} at ${binPath}`);
    return binPath;
  }

  return null;
}

/**
 * Downloads fly-client binary from Artifactory
 * @returns Path to downloaded file
 */
async function downloadBinary(
  os: string,
  arch: string,
  extension: string,
): Promise<string> {
  const downloadUrl = `${FLY_CLIENT_BASE_URL}/[RELEASE]/${os}-${arch}/${FLY_BINARY_NAME}${extension}`;
  core.info(`Downloading ${FLY_TOOL_NAME} from ${downloadUrl}`);

  try {
    return await tc.downloadTool(downloadUrl);
  } catch (error) {
    throw new Error(
      `Failed to download from ${downloadUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Prepares the binary (move, chmod) and caches it
 * @returns Path to the cached binary
 */
async function prepareBinary(
  downloadPath: string,
  os: string,
  arch: string,
  extension: string,
): Promise<string> {
  const tempDir = path.join(
    process.env.RUNNER_TEMP || "/tmp",
    `${FLY_TOOL_NAME}-${Date.now()}`,
  );
  fs.mkdirSync(tempDir, { recursive: true });

  const binaryName = `${FLY_BINARY_NAME}${extension}`;
  const binaryPath = path.join(tempDir, binaryName);
  fs.renameSync(downloadPath, binaryPath);

  // Make executable on Unix
  if (process.platform !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
  }

  // Cache it
  const cachedPath = await tc.cacheDir(
    tempDir,
    FLY_TOOL_NAME,
    FLY_CACHE_VERSION,
    `${os}-${arch}`,
  );
  return path.join(cachedPath, binaryName);
}

/**
 * Gets the Fly CLI binary (from cache or by downloading)
 * @returns Path to the fly binary
 */
async function downloadAndCacheFlyClient(): Promise<string> {
  const { os, arch, extension } = getPlatformInfo();

  // Step 1: Check cache
  const cachedBinary = findCachedBinary(os, arch, extension);
  if (cachedBinary) {
    return cachedBinary;
  }

  // Step 2: Download
  core.info(`${FLY_TOOL_NAME} not cached, downloading...`);
  const downloadPath = await downloadBinary(os, arch, extension);

  // Step 3-4: Prepare and cache
  const binaryPath = await prepareBinary(downloadPath, os, arch, extension);

  return binaryPath;
}

/**
 * Resolves the platform-specific Fly binary path by downloading and caching it
 * @returns Path to the fly binary
 */
export async function resolveFlyCLIBinaryPath(): Promise<string> {
  const binPath = await downloadAndCacheFlyClient();

  if (!fs.existsSync(binPath)) {
    throw new Error(
      `Fly CLI binary not found at ${binPath} after download. This should not happen.`,
    );
  }

  core.info(`Fly CLI binary ready at: ${binPath}`);
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

    // Get all package managers (supported standard + detected containers)
    const workspacePath = process.env.GITHUB_WORKSPACE || "";
    const allPackageManagers = await getAllPackageManagers(workspacePath);
    core.saveState(
      STATE_FLY_PACKAGE_MANAGERS,
      JSON.stringify(allPackageManagers),
    );
    core.info(
      `Saved package managers to state: ${JSON.stringify(allPackageManagers)}`,
    );

    const binPath = await resolveFlyCLIBinaryPath();
    core.info(`CLI binary path: ${binPath}`);
    const envVars: Record<string, string> = {
      FLY_URL: url,
      FLY_ACCESS_TOKEN: accessToken,
      FLY_IGNORE_PACKAGE_MANAGERS: ignorePackageManagers,
    };

    const options = {
      env: { ...process.env, ...envVars } as Record<string, string>,
    };

    // Pass all package managers to fly-client
    core.info(
      `Executing Fly CLI setup for managers: ${allPackageManagers.join(", ")}`,
    );
    const args = ["setup", ...allPackageManagers];
    const exitCode = await exec.exec(binPath, args, options);

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

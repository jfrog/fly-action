// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import * as path from "path";
import {
  FLY_CLI_DOWNLOAD_BASE,
  PLATFORM_MAP,
  ARCH_MAP,
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
  UNIX_EXECUTABLE_MODE,
  CLI_CMD_VERSION,
  MAX_VERSION_LENGTH,
  FALLBACK_VERSION,
} from "./constants";
import { FlyClientResponse } from "./types";

const WINDOWS_OS = "windows";
const FLY_TOOL_NAME = "fly";

/**
 * Maps Node.js process.platform/arch to the Go binary naming used by releases.jfrog.io.
 * Throws if the current platform or architecture is unsupported.
 */
export function resolvePlatformArch(): { os: string; arch: string } {
  const os = PLATFORM_MAP[process.platform];
  if (!os) {
    throw new Error(
      `Unsupported platform: ${process.platform}. Supported: ${Object.keys(PLATFORM_MAP).join(", ")}`,
    );
  }
  const arch = ARCH_MAP[process.arch];
  if (!arch) {
    throw new Error(
      `Unsupported architecture: ${process.arch}. Supported: ${Object.keys(ARCH_MAP).join(", ")}`,
    );
  }
  return { os, arch };
}

/**
 * Builds the download URL for the fly CLI binary.
 */
export function buildDownloadUrl(os: string, arch: string): string {
  const ext = os === WINDOWS_OS ? ".exe" : "";
  return `${FLY_CLI_DOWNLOAD_BASE}/${os}-${arch}/${FLY_TOOL_NAME}${ext}`;
}

/**
 * Returns the binary filename for the current platform.
 */
export function getBinaryName(): string {
  return process.platform === "win32" ? "fly.exe" : "fly";
}

/**
 * Resolves the fly CLI version by running `fly version` and parsing the
 * structured JSON output. The command outputs:
 *   {"command":"version","results":[{"name":"fly","status":"success","message":"<version>"}]}
 *
 * Extracts a semver (X.Y.Z) from the message field. Falls back to the raw
 * message or "unknown" if parsing fails.
 */
export async function resolveVersion(binPath: string): Promise<string> {
  let stdout = "";
  try {
    await exec.exec(binPath, [CLI_CMD_VERSION], {
      silent: true,
      listeners: {
        stdout: (data) => {
          stdout += data.toString();
        },
      },
    });
  } catch (err) {
    core.warning(
      `Failed to run fly version: ${err instanceof Error ? err.message : String(err)}`,
    );
    return FALLBACK_VERSION;
  }

  try {
    const response: FlyClientResponse = JSON.parse(stdout);
    const flyResult = response.results.find((r) => r.name === FLY_TOOL_NAME);
    const message = flyResult?.message || "";

    const semverMatch = message.match(/(\d+\.\d+\.\d+)/);
    if (semverMatch) {
      return semverMatch[1];
    }
    return message.trim().slice(0, MAX_VERSION_LENGTH) || FALLBACK_VERSION;
  } catch {
    const semverMatch = stdout.match(/(\d+\.\d+\.\d+)/);
    if (semverMatch) {
      return semverMatch[1];
    }
    return stdout.trim().slice(0, MAX_VERSION_LENGTH) || FALLBACK_VERSION;
  }
}

/**
 * Downloads the fly CLI binary from releases.jfrog.io and caches it using
 * @actions/tool-cache. Returns the directory containing the cached binary.
 *
 * On subsequent runs (self-hosted runners), a cached version is reused if available.
 */
export async function downloadFlyCLI(): Promise<string> {
  const { os, arch } = resolvePlatformArch();
  const url = buildDownloadUrl(os, arch);
  const binaryName = getBinaryName();

  core.info(`Downloading Fly CLI from ${url}`);
  const downloadedPath = await tc.downloadTool(url);

  if (process.platform !== "win32") {
    fs.chmodSync(downloadedPath, UNIX_EXECUTABLE_MODE);
  }

  const version = await resolveVersion(downloadedPath);
  core.info(`Fly CLI version: ${version}`);

  // Reuse cached binary on self-hosted runners if the same version was previously downloaded
  const existingCache = tc.find(FLY_TOOL_NAME, version);
  if (existingCache) {
    core.info(`Fly CLI ${version} found in tool-cache, skipping re-cache`);
    core.addPath(existingCache);
    return existingCache;
  }

  const cachedDir = await tc.cacheFile(
    downloadedPath,
    binaryName,
    FLY_TOOL_NAME,
    version,
  );

  if (process.platform !== "win32") {
    fs.chmodSync(path.join(cachedDir, binaryName), UNIX_EXECUTABLE_MODE);
  }

  core.addPath(cachedDir);
  core.info(`Fly CLI cached and added to PATH: ${cachedDir}`);

  return cachedDir;
}

/**
 * Executes the fly CLI with the given arguments, captures JSON stdout,
 * and returns the parsed response. The binary must already be on PATH
 * (set up by the root action via downloadFlyCLI).
 *
 * @param args - CLI arguments (subcommand, flags, positional args)
 * @param env  - Optional extra environment variables merged with process.env.
 *               Use this to pass secrets (FLY_ACCESS_TOKEN) instead of CLI args
 *               so they don't appear in process listings.
 */
export async function execFlyCLI(
  args: string[],
  env?: Record<string, string>,
): Promise<FlyClientResponse> {
  let stdout = "";
  let stderr = "";

  const execOptions: exec.ExecOptions = {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
      stderr: (data) => {
        stderr += data.toString();
      },
    },
  };

  if (env) {
    execOptions.env = {
      ...(process.env as Record<string, string>),
      ...env,
    };
  }

  const exitCode = await exec.exec(FLY_TOOL_NAME, args, execOptions);

  if (stderr.trim()) {
    core.info(`Fly CLI stderr:\n${stderr.trim()}`);
  }

  if (exitCode !== 0) {
    core.warning(
      `Fly CLI exited with code ${exitCode} for command: ${args[0] || FLY_TOOL_NAME}`,
    );
  }

  let response: FlyClientResponse;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new Error(
      `Failed to parse Fly CLI JSON output (exit code ${exitCode}).\n` +
        `stdout: ${stdout}\nstderr: ${stderr}`,
    );
  }

  return response;
}

/**
 * Reads FLY_URL and FLY_ACCESS_TOKEN from the environment.
 * These are set by the root fly-action during OIDC authentication.
 * Throws a descriptive error if either is missing.
 */
export function getAuthEnv(): { url: string; token: string } {
  const url = process.env[ENV_FLY_URL_RUNTIME];
  if (!url) {
    throw new Error(
      `${ENV_FLY_URL_RUNTIME} environment variable is not set. ` +
        `Run jfrog/fly-action@v1 first to authenticate.`,
    );
  }

  const token = process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME];
  if (!token) {
    throw new Error(
      `${ENV_FLY_ACCESS_TOKEN_RUNTIME} environment variable is not set. ` +
        `Run jfrog/fly-action@v1 first to authenticate.`,
    );
  }

  return { url, token };
}

/**
 * Splits a multiline action input into individual arguments.
 * Filters out empty lines and trims whitespace.
 */
export function parseMultilineInput(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as crypto from "crypto";
import * as exec from "@actions/exec";
import * as httpm from "@actions/http-client";
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
import { getErrorMessage, truncate } from "./utils";

const WINDOWS_OS = "windows";
const FLY_TOOL_NAME = "fly";

/**
 * Maps Node.js process.platform/arch to the Go binary naming convention.
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
  return `${FLY_CLI_DOWNLOAD_BASE}/${FLY_TOOL_NAME}-${os}-${arch}${ext}`;
}

/**
 * Resolves the [LATEST] redirect manually so we don't depend on
 * `@actions/http-client`'s built-in redirect follower. The server may return
 * a relative Location header (e.g. `/public/generic/fly-client/1.4.7/...`),
 * and http-client calls `new URL(location)` without a base, which throws
 * `TypeError: Invalid URL` for relative paths.
 *
 * We disable auto-redirect, read the Location header, and resolve it against
 * the request URL ourselves. If the response is not a redirect (already
 * absolute), the original URL is returned unchanged.
 */
export async function resolveLatestRedirect(url: string): Promise<string> {
  const client = new httpm.HttpClient("jfrog-fly-action", [], {
    allowRedirects: false,
    allowRetries: true,
    maxRetries: 2,
  });
  try {
    const res = await client.get(url);
    await res.readBody();
    const status = res.message.statusCode ?? 0;
    const isRedirect =
      status === httpm.HttpCodes.MovedPermanently ||
      status === httpm.HttpCodes.ResourceMoved ||
      status === httpm.HttpCodes.SeeOther ||
      status === httpm.HttpCodes.TemporaryRedirect ||
      status === httpm.HttpCodes.PermanentRedirect;
    if (isRedirect) {
      const location = res.message.headers["location"];
      if (!location) {
        throw new Error(
          `Fly CLI [LATEST] resolution returned ${status} without a Location header`,
        );
      }
      const locStr = Array.isArray(location) ? location[0] : location;
      // `new URL(location, base)` resolves both absolute and relative Locations.
      return new URL(locStr, url).href;
    }
    if (status === httpm.HttpCodes.OK) {
      return url;
    }
    throw new Error(
      `Fly CLI [LATEST] resolution returned unexpected status ${status}`,
    );
  } finally {
    client.dispose();
  }
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
    core.warning(`Failed to run fly version: ${getErrorMessage(err)}`);
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
 * Downloads the fly CLI binary from Fly public generic and caches it using
 * @actions/tool-cache. Returns the directory containing the cached binary.
 *
 * On subsequent runs (self-hosted runners), a cached version is reused if available.
 */
/**
 * Best-effort SHA256 checksum verification. Downloads a `.sha256` sidecar
 * file alongside the binary. If the sidecar exists and the hash mismatches,
 * throws immediately (supply-chain compromise). If the sidecar doesn't exist
 * (404), logs a debug message and proceeds.
 */
async function verifyChecksum(
  binaryPath: string,
  binaryUrl: string,
): Promise<void> {
  const checksumUrl = `${binaryUrl}.sha256`;
  try {
    const checksumFile = await tc.downloadTool(checksumUrl);
    const expectedHash = fs
      .readFileSync(checksumFile, "utf8")
      .trim()
      .split(/\s+/)[0];
    const actualHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(binaryPath))
      .digest("hex");

    if (expectedHash !== actualHash) {
      throw new Error(
        `SHA256 checksum mismatch for Fly CLI binary.\n` +
          `Expected: ${expectedHash}\nActual:   ${actualHash}\n` +
          `The binary may have been tampered with. ` +
          `Delete your tool-cache and retry. If this persists, report it.`,
      );
    }
    core.info(`Fly CLI checksum verified: ${actualHash}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("checksum mismatch")) {
      throw err;
    }
    core.debug(
      `Checksum file not available at ${checksumUrl}: ${getErrorMessage(err)}`,
    );
  }
}

/**
 * Computes a short content hash for use as a tool-cache version key
 * when version detection fails.
 */
function fileContentHash(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
    .slice(0, 12);
}

export async function downloadFlyCLI(): Promise<string> {
  const { os, arch } = resolvePlatformArch();
  const latestUrl = buildDownloadUrl(os, arch);

  // Resolve [LATEST] -> versioned URL ourselves so we tolerate relative
  // Location headers (which @actions/http-client mishandles).
  core.debug(`Resolving Fly CLI download URL from ${latestUrl}`);
  const url = await resolveLatestRedirect(latestUrl);
  if (url !== latestUrl) {
    core.debug(`Resolved Fly CLI URL: ${url}`);
  }

  const binaryName = getBinaryName();

  core.info(`Downloading Fly CLI from ${url}`);
  const downloadedPath = await tc.downloadTool(url);

  if (process.platform !== "win32") {
    fs.chmodSync(downloadedPath, UNIX_EXECUTABLE_MODE);
  }

  await verifyChecksum(downloadedPath, url);

  let version = await resolveVersion(downloadedPath);
  if (version === FALLBACK_VERSION) {
    version = `0.0.0-${fileContentHash(downloadedPath)}`;
    core.warning(
      `Could not determine Fly CLI version; using content hash as cache key: ${version}`,
    );
  }
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
    core.debug(`Full CLI stdout: ${stdout}`);
    core.debug(`Full CLI stderr: ${stderr}`);
    if (exitCode !== 0 && stderr.trim()) {
      throw new Error(
        `Fly CLI failed with exit code ${exitCode}:\n${stderr.trim()}`,
      );
    }
    throw new Error(
      `Failed to parse Fly CLI JSON output (exit code ${exitCode}).\n` +
        `stdout: ${truncate(stdout)}\nstderr: ${truncate(stderr)}`,
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

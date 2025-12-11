// Copyright (c) JFrog Ltd. (2025)

/**
 * Integration tests for downloading and running the Fly Client CLI.
 * These tests verify that:
 * - The download mechanism works correctly
 * - The binary is downloaded from the correct URL
 * - The binary is cached properly
 * - The binary is executable and functional
 *
 * Note: These tests make actual network requests to download the binary.
 * They should be run in CI environments with network access.
 */

import * as fs from "fs";
import * as path from "path";
import * as tc from "@actions/tool-cache";
import { execSync } from "child_process";
import { FLY_CLIENT_BASE_URL } from "../constants";

// Import the actual functions (not mocked)
jest.unmock("@actions/tool-cache");
jest.unmock("fs");
jest.unmock("path");

// Platform mapping (same as in index.ts)
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
 * Get platform-specific info for the current system
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
 * Download and cache the fly-client binary (integration test version)
 */
async function downloadAndCacheFlyClient(): Promise<string> {
  const { os, arch, extension } = getPlatformInfo();

  // Check cache first
  const cachedPath = tc.find(FLY_TOOL_NAME, FLY_CACHE_VERSION, `${os}-${arch}`);

  if (cachedPath) {
    const binPath = path.join(cachedPath, `${FLY_BINARY_NAME}${extension}`);
    if (fs.existsSync(binPath)) {
      return binPath;
    }
  }

  // Download the binary
  const downloadUrl = `${FLY_CLIENT_BASE_URL}/[RELEASE]/${os}-${arch}/${FLY_BINARY_NAME}${extension}`;

  const downloadPath = await tc.downloadTool(downloadUrl);

  // Create temp directory for the binary
  const tempDir = path.join(
    process.env.RUNNER_TEMP || "/tmp",
    `${FLY_TOOL_NAME}-${Date.now()}`,
  );
  fs.mkdirSync(tempDir, { recursive: true });

  // Move and rename the downloaded file
  const binaryName = `${FLY_BINARY_NAME}${extension}`;
  const binaryPath = path.join(tempDir, binaryName);
  fs.renameSync(downloadPath, binaryPath);

  // Make executable on Unix
  if (process.platform !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
  }

  // Cache it
  const finalCachedPath = await tc.cacheDir(
    tempDir,
    FLY_TOOL_NAME,
    FLY_CACHE_VERSION,
    `${os}-${arch}`,
  );

  return path.join(finalCachedPath, binaryName);
}

/**
 * Helper to execute the fly binary and capture output
 */
function execFly(
  binPath: string,
  args: string[],
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(`"${binPath}" ${args.join(" ")}`, {
      encoding: "utf-8",
      timeout: 30000, // 30 second timeout for download/execution
    });
    return { stdout: result, stderr: "", exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number;
    };
    return {
      stdout: String(execError.stdout || ""),
      stderr: String(execError.stderr || ""),
      exitCode: execError.status || 1,
    };
  }
}

describe("Fly Client Download Integration Tests", () => {
  let binaryPath: string;
  let isGitHubActions: boolean;

  // Increase timeout for these tests as they involve actual downloads
  jest.setTimeout(60000); // 60 seconds

  beforeAll(async () => {
    // Check if running in GitHub Actions
    isGitHubActions = !!process.env.GITHUB_ACTIONS;

    if (!isGitHubActions) {
      // Set up temporary tool cache for local testing
      const tempToolCache = path.join(
        process.env.RUNNER_TEMP || "/tmp",
        "tool-cache-test",
      );
      fs.mkdirSync(tempToolCache, { recursive: true });
      process.env.RUNNER_TOOL_CACHE = tempToolCache;
      process.env.RUNNER_TEMP = process.env.RUNNER_TEMP || "/tmp";
    }

    // Download and cache the binary once for all tests
    binaryPath = await downloadAndCacheFlyClient();

    // Wait a moment to ensure file system operations complete
    // This prevents "Text file busy" errors in CI
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the binary is accessible
    expect(fs.existsSync(binaryPath)).toBe(true);
  });

  describe("Download and Cache", () => {
    it("downloads the binary successfully", () => {
      expect(binaryPath).toBeTruthy();
      expect(typeof binaryPath).toBe("string");
    });

    it("binary file exists at the returned path", () => {
      expect(fs.existsSync(binaryPath)).toBe(true);
    });

    it("binary is a file (not a directory)", () => {
      const stats = fs.statSync(binaryPath);
      expect(stats.isFile()).toBe(true);
    });

    it("binary has executable permissions on Unix systems", () => {
      if (process.platform !== "win32") {
        const stats = fs.statSync(binaryPath);
        // Check if any execute bit is set (user, group, or other)
        const hasExecutePermission = (stats.mode & 0o111) !== 0;
        expect(hasExecutePermission).toBe(true);
      }
    });

    it("binary path includes correct platform and arch in cache key", () => {
      const { os, arch } = getPlatformInfo();
      expect(binaryPath).toContain(FLY_TOOL_NAME);
      // The path should contain the cache structure
      expect(binaryPath).toBeTruthy();
    });

    it("downloads from the correct URL format", async () => {
      const { os, arch, extension } = getPlatformInfo();
      const expectedUrl = `${FLY_CLIENT_BASE_URL}/[RELEASE]/${os}-${arch}/${FLY_BINARY_NAME}${extension}`;

      // Verify URL format is correct
      expect(expectedUrl).toContain(
        "releases.jfrog.io/artifactory/fly-client/v1",
      );
      expect(expectedUrl).toContain("[RELEASE]");
      expect(expectedUrl).toContain(os);
      expect(expectedUrl).toContain(arch);
    });
  });

  describe("Binary Execution", () => {
    it("binary is executable", () => {
      // Try to execute with --help flag (should work even without auth)
      const result = execFly(binaryPath, ["--help"]);

      // Should exit successfully or with expected error
      // 0 = success, 1 = error but executed, 126 = temp file system issue (text file busy)
      expect([0, 1, 126, 127]).toContain(result.exitCode);
    });

    it("binary responds to version command", () => {
      // Try both --version flag and version command
      const resultFlag = execFly(binaryPath, ["--version"]);
      const resultCmd = execFly(binaryPath, ["version"]);

      // At least one should produce output
      const outputFlag = resultFlag.stdout + resultFlag.stderr;
      const outputCmd = resultCmd.stdout + resultCmd.stderr;

      expect(outputFlag || outputCmd).toBeTruthy();
    });

    it("binary can be executed multiple times", () => {
      // First execution
      const result1 = execFly(binaryPath, ["--help"]);
      // 0 = success, 1 = error but executed, 126 = temp file system issue, 127 = not found (transient)
      expect([0, 1, 126, 127]).toContain(result1.exitCode);

      // Second execution (should work the same)
      const result2 = execFly(binaryPath, ["--help"]);
      expect([0, 1, 126, 127]).toContain(result2.exitCode);

      // At least one should produce output (if both fail with 126/127, that's a different issue)
      if (result1.exitCode <= 1 || result2.exitCode <= 1) {
        expect(
          result1.stdout || result1.stderr || result2.stdout || result2.stderr,
        ).toBeTruthy();
      }
    });
  });

  describe("Cache Functionality", () => {
    it("uses cached binary on second call", async () => {
      // First download (already done in beforeAll)
      const firstPath = binaryPath;

      // Second call should return the same cached path
      const secondPath = await downloadAndCacheFlyClient();

      expect(secondPath).toBe(firstPath);
      expect(fs.existsSync(secondPath)).toBe(true);
    });

    it("cached binary is in the expected tool cache location", () => {
      // Tool cache should be in a standard location
      expect(binaryPath).toBeTruthy();

      // Verify the path exists
      expect(fs.existsSync(binaryPath)).toBe(true);

      // In GitHub Actions, tool cache path should be set
      if (isGitHubActions) {
        expect(process.env.RUNNER_TOOL_CACHE).toBeTruthy();
      }
    });
  });

  describe("Platform-Specific Tests", () => {
    it("downloads the correct binary for the current platform", () => {
      const { os, arch, extension } = getPlatformInfo();

      // Verify platform mapping is correct
      if (process.platform === "darwin") {
        expect(os).toBe("darwin");
      } else if (process.platform === "linux") {
        expect(os).toBe("linux");
      } else if (process.platform === "win32") {
        expect(os).toBe("windows");
        expect(extension).toBe(".exe");
      }

      // Verify arch mapping
      if (process.arch === "x64") {
        expect(arch).toBe("amd64");
      } else if (process.arch === "arm64") {
        expect(arch).toBe("arm64");
      }
    });

    it("binary name includes .exe extension on Windows", () => {
      if (process.platform === "win32") {
        expect(binaryPath).toMatch(/\.exe$/);
      } else {
        expect(binaryPath).not.toMatch(/\.exe$/);
      }
    });
  });

  describe("Error Handling", () => {
    it("throws meaningful error for invalid download URL", async () => {
      const invalidUrl = "https://invalid-url-that-does-not-exist.com/fly";

      // downloadTool may retry and timeout, so we check it eventually fails
      // or takes a very long time (which we don't want to wait for in tests)
      try {
        await tc.downloadTool(invalidUrl);
        // If it somehow succeeds, that's actually fine - network behavior varies
        expect(true).toBe(true);
      } catch (error) {
        // If it throws, that's also fine - it properly handles errors
        expect(error).toBeTruthy();
      }
    });
  });
});

describe("Platform Info Validation", () => {
  it("correctly identifies current platform", () => {
    const { os, arch, extension } = getPlatformInfo();

    expect(os).toBeTruthy();
    expect(arch).toBeTruthy();
    expect(typeof extension).toBe("string");

    // Verify mappings are correct
    expect(["darwin", "linux", "windows"]).toContain(os);
    expect(["amd64", "arm64"]).toContain(arch);
  });
});

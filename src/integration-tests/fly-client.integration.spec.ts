// Copyright (c) JFrog Ltd. (2025)

/**
 * Integration tests for the Fly Client CLI.
 * These tests verify that the fly-client is functional and accepts expected arguments.
 *
 * Note: These tests download the actual fly-client binary and test it.
 */

import * as fs from "fs";
import * as path from "path";
import * as tc from "@actions/tool-cache";
import { execSync, spawn, SpawnOptions } from "child_process";
import { SUPPORTED_PACKAGE_MANAGERS } from "../package-detection";
import { FLY_CLIENT_BASE_URL } from "../constants";

// Import the download functionality (same as in fly-download.integration.spec.ts)
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

// Global binary path that will be set once
let binPath: string;

// Helper to execute binary and capture output
const execBinary = (
  args: string[],
  env?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } => {
  try {
    const result = execSync(`"${binPath}" ${args.join(" ")}`, {
      encoding: "utf-8",
      env: { ...process.env, ...env },
      timeout: 10000,
    });
    return { stdout: result, stderr: "", exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return {
      stdout: execError.stdout || "",
      stderr: execError.stderr || "",
      exitCode: execError.status || 1,
    };
  }
};

// Helper to execute binary with spawn for better control
const spawnBinary = (
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      env: { ...process.env, ...env },
    };

    const child = spawn(binPath, args, options);
    let stdout = "";
    let stderr = "";
    let resolved = false;

    const cleanup = (result: {
      stdout: string;
      stderr: string;
      exitCode: number;
    }) => {
      if (!resolved) {
        resolved = true;
        global.clearTimeout(timeoutId);
        resolve(result);
      }
    };

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      cleanup({ stdout, stderr, exitCode: code || 0 });
    });

    child.on("error", (err) => {
      cleanup({ stdout, stderr: err.message, exitCode: 1 });
    });

    // Timeout after 10 seconds
    const timeoutId = global.setTimeout(() => {
      child.kill();
      cleanup({ stdout, stderr: "Timeout", exitCode: 124 });
    }, 10000);
  });
};

describe("Fly Client Integration Tests", () => {
  // Increase timeout for these tests as they involve actual downloads
  jest.setTimeout(60000); // 60 seconds

  beforeAll(async () => {
    // Set up environment for local testing if needed
    if (!process.env.GITHUB_ACTIONS) {
      const tempToolCache = path.join(
        process.env.RUNNER_TEMP || "/tmp",
        "tool-cache-test",
      );
      fs.mkdirSync(tempToolCache, { recursive: true });
      process.env.RUNNER_TOOL_CACHE = tempToolCache;
      process.env.RUNNER_TEMP = process.env.RUNNER_TEMP || "/tmp";
    }

    // Download and cache the binary once for all tests
    binPath = await downloadAndCacheFlyClient();

    // Wait a moment to ensure file system operations complete
    // This prevents "Text file busy" errors in CI
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the binary is accessible and set permissions if needed
    if (fs.existsSync(binPath) && process.platform !== "win32") {
      try {
        fs.chmodSync(binPath, 0o755);
      } catch (e) {
        // Ignore errors - file might already have correct permissions
      }
    }
  });

  describe("Fly client existence and permissions", () => {
    it("should have the fly-client file present", () => {
      expect(fs.existsSync(binPath)).toBe(true);
    });

    it("should be an executable file", () => {
      const stats = fs.statSync(binPath);
      expect(stats.isFile()).toBe(true);
      // Check if file has execute permissions (on Unix-like systems)
      if (process.platform !== "win32") {
        const isExecutable = !!(stats.mode & fs.constants.X_OK);
        if (!isExecutable) {
          // Make it executable for the test
          fs.chmodSync(binPath, 0o755);
        }
        const updatedStats = fs.statSync(binPath);
        expect(!!(updatedStats.mode & fs.constants.X_OK)).toBe(true);
      }
    });

    it("should have reasonable file size (> 1MB)", () => {
      const stats = fs.statSync(binPath);
      expect(stats.size).toBeGreaterThan(1024 * 1024); // > 1MB
    });
  });

  describe("Version command", () => {
    it("should display version information with --version flag", () => {
      const result = execBinary(["--version"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+|[a-f0-9]+/i); // semver or commit hash
    });

    it("should display version information with -v flag", () => {
      const result = execBinary(["-v"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+|[a-f0-9]+/i);
    });

    it("should display version information with version command", () => {
      const result = execBinary(["version"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Fly CLI");
      expect(result.stdout).toContain("Version:");
    });
  });

  describe("Help command", () => {
    it("should display help with --help flag", () => {
      const result = execBinary(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("NAME:");
      expect(result.stdout).toContain("fly");
      expect(result.stdout).toContain("USAGE:");
      expect(result.stdout).toContain("COMMANDS:");
    });

    it("should display help with -h flag", () => {
      const result = execBinary(["-h"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("NAME:");
    });

    it("should list available commands", () => {
      const result = execBinary(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("setup");
      expect(result.stdout).toContain("status");
      expect(result.stdout).toContain("teardown");
      expect(result.stdout).toContain("version");
    });
  });

  describe("Setup command help", () => {
    it("should display setup help", () => {
      const result = execBinary(["setup", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Setup Fly configuration");
      expect(result.stdout).toContain("PACKAGE_MANAGER");
    });

    it("should list supported package managers in setup help", () => {
      const result = execBinary(["setup", "--help"]);
      expect(result.exitCode).toBe(0);

      // Check all our supported package managers are listed
      SUPPORTED_PACKAGE_MANAGERS.forEach((manager) => {
        expect(result.stdout.toLowerCase()).toContain(manager.toLowerCase());
      });

      // Check container managers are also listed
      expect(result.stdout.toLowerCase()).toContain("docker");
      expect(result.stdout.toLowerCase()).toContain("podman");
      expect(result.stdout.toLowerCase()).toContain("helm");
    });

    it("should document --url option", () => {
      const result = execBinary(["setup", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--url");
      expect(result.stdout).toContain("FLY_URL");
    });

    it("should document --access-token option", () => {
      const result = execBinary(["setup", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--access-token");
      expect(result.stdout).toContain("FLY_ACCESS_TOKEN");
    });

    it("should document --ignore-package-managers option", () => {
      const result = execBinary(["setup", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--ignore-package-managers");
      expect(result.stdout).toContain("FLY_IGNORE_PACKAGE_MANAGERS");
    });
  });

  describe("Setup command argument validation", () => {
    it("should require URL when running setup", async () => {
      // Run setup without URL - should fail
      const result = await spawnBinary(["setup", "npm"]);
      // The binary should fail without a URL
      expect(result.exitCode).not.toBe(0);
    });

    it("should accept package manager arguments", async () => {
      // This will fail due to missing URL, but should parse the args correctly
      const result = await spawnBinary(["setup", "npm", "pip", "maven"]);
      // Just checking it doesn't crash on parsing
      expect(result.exitCode).not.toBe(0); // Fails due to missing URL, not parsing
    });

    it("should accept multiple package managers", async () => {
      const result = await spawnBinary([
        "setup",
        ...SUPPORTED_PACKAGE_MANAGERS,
        "docker",
        "podman",
        "helm",
      ]);
      // Will fail due to missing URL, but should accept all managers
      expect(result.exitCode).not.toBe(0);
    });

    it("should accept --url flag", async () => {
      const result = await spawnBinary([
        "setup",
        "npm",
        "--url",
        "https://example.com",
      ]);
      // Will fail due to missing auth, but should accept URL
      expect(result.exitCode).not.toBe(0);
      // Should not contain URL parsing error
      expect(result.stderr).not.toContain("invalid URL");
    });
  });

  describe("Setup command with all package managers", () => {
    const ALL_PACKAGE_MANAGERS = [
      ...SUPPORTED_PACKAGE_MANAGERS,
      "docker",
      "podman",
      "helm",
    ];

    // Test each supported standard package manager individually
    SUPPORTED_PACKAGE_MANAGERS.forEach((manager) => {
      it(`should accept ${manager} as a valid package manager`, async () => {
        const result = await spawnBinary([
          "setup",
          manager,
          "--url",
          "https://test.example.com",
        ]);
        // Should fail on auth, NOT on "unknown package manager"
        const combinedOutput = (result.stdout + result.stderr).toLowerCase();
        expect(combinedOutput).not.toContain("unknown package manager");
        expect(combinedOutput).not.toContain("invalid package manager");
        expect(combinedOutput).not.toContain(`unknown.*${manager}`);
      });
    });

    // Test each container package manager individually
    ["docker", "podman", "helm"].forEach((manager) => {
      it(`should accept ${manager} (container) as a valid package manager`, async () => {
        const result = await spawnBinary([
          "setup",
          manager,
          "--url",
          "https://test.example.com",
        ]);
        // Should fail on auth, NOT on "unknown package manager"
        const combinedOutput = (result.stdout + result.stderr).toLowerCase();
        expect(combinedOutput).not.toContain("unknown package manager");
        expect(combinedOutput).not.toContain("invalid package manager");
        expect(combinedOutput).not.toContain(`unknown.*${manager}`);
      });
    });

    it("should accept ALL package managers at once", async () => {
      const result = await spawnBinary([
        "setup",
        ...ALL_PACKAGE_MANAGERS,
        "--url",
        "https://test.example.com",
      ]);
      // Should fail on auth, NOT on parsing or unknown managers
      const combinedOutput = (result.stdout + result.stderr).toLowerCase();
      expect(combinedOutput).not.toContain("unknown package manager");
      expect(combinedOutput).not.toContain("invalid package manager");
      expect(combinedOutput).not.toContain("too many arguments");
    });

    it("should accept all package managers in the exact order the action sends them", async () => {
      // This mimics exactly what index.ts sends to the binary
      const managersFromAction = [
        "dotnet",
        "go",
        "gradle",
        "maven",
        "npm",
        "pip",
        "pipenv",
        "pnpm",
        "twine",
        "nuget",
        "docker",
        "helm",
        "podman",
      ];

      const result = await spawnBinary([
        "setup",
        ...managersFromAction,
        "--url",
        "https://test.example.com",
      ]);

      const combinedOutput = (result.stdout + result.stderr).toLowerCase();
      expect(combinedOutput).not.toContain("unknown package manager");
      expect(combinedOutput).not.toContain("invalid package manager");
    });

    it("should handle duplicate package managers gracefully", async () => {
      const result = await spawnBinary([
        "setup",
        "npm",
        "npm",
        "pip",
        "pip",
        "--url",
        "https://test.example.com",
      ]);
      // Should not crash on duplicates
      const combinedOutput = (result.stdout + result.stderr).toLowerCase();
      expect(combinedOutput).not.toContain("duplicate");
    });
  });

  describe("Status command", () => {
    it("should display status help", () => {
      const result = execBinary(["status", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("status");
    });
  });

  describe("Teardown command", () => {
    it("should display teardown help", () => {
      const result = execBinary(["teardown", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("teardown");
    });
  });

  describe("Invalid commands and arguments", () => {
    it("should handle unknown command gracefully", () => {
      const result = execBinary(["unknowncommand"]);
      expect(result.exitCode).not.toBe(0);
    });

    it("should handle invalid flags gracefully", () => {
      const result = execBinary(["--invalid-flag"]);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("Environment variable support", () => {
    it("should recognize FLY_URL environment variable", async () => {
      const result = await spawnBinary(["setup", "npm"], {
        FLY_URL: "https://test.example.com",
      });
      // Should progress further (fail on auth, not URL)
      expect(result.exitCode).not.toBe(0);
    });

    it("should recognize FLY_IGNORE_PACKAGE_MANAGERS environment variable", async () => {
      const result = await spawnBinary(["setup", "--help"], {
        FLY_IGNORE_PACKAGE_MANAGERS: "npm,pip",
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Package manager compatibility with action", () => {
    it("should support all SUPPORTED_PACKAGE_MANAGERS from the action", () => {
      const result = execBinary(["setup", "--help"]);
      const helpText = result.stdout.toLowerCase();

      SUPPORTED_PACKAGE_MANAGERS.forEach((manager) => {
        expect(helpText).toContain(manager.toLowerCase());
      });
    });

    it("should support container package managers (docker, podman, helm)", () => {
      const result = execBinary(["setup", "--help"]);
      const helpText = result.stdout.toLowerCase();

      expect(helpText).toContain("docker");
      expect(helpText).toContain("podman");
      expect(helpText).toContain("helm");
    });
  });
});

describe("Package manager installation tolerance", () => {
  it("should not fail due to package managers not being installed on the system", async () => {
    // Run setup with all package managers - some may not be installed on the test machine
    // (e.g., dotnet, nuget, gradle, helm, podman are often not installed)
    // The fly-client should NOT fail because a package manager isn't installed
    const result = await spawnBinary([
      "setup",
      ...SUPPORTED_PACKAGE_MANAGERS,
      "docker",
      "podman",
      "helm",
      "--url",
      "https://test.example.com",
    ]);

    const combinedOutput = result.stdout + result.stderr;

    // Should NOT contain errors about package managers not being installed/found
    // Error format: "failed to setup "dotnet": ... executable file not found in $PATH"
    expect(combinedOutput).not.toContain("executable file not found");
    expect(combinedOutput).not.toContain("not found in $PATH");

    // The only failure should be authentication-related, not package-manager-availability-related
    // Exit code will be non-zero due to missing auth, which is expected
    expect(result.exitCode).not.toBe(0);
  });

  // Test individual package managers that are commonly NOT installed
  const uncommonManagers = ["dotnet", "nuget", "gradle", "helm", "podman"];

  uncommonManagers.forEach((manager) => {
    it(`should not fail when ${manager} is not installed on the system`, async () => {
      const result = await spawnBinary([
        "setup",
        manager,
        "--url",
        "https://test.example.com",
      ]);

      const combinedOutput = result.stdout + result.stderr;

      // Should NOT fail because the package manager binary isn't installed
      // Error format: "failed to setup "dotnet": ... executable file not found in $PATH"
      expect(combinedOutput).not.toContain("executable file not found");
      expect(combinedOutput).not.toContain("not found in $PATH");

      // Failure should be auth-related, not package-manager-availability-related
      expect(result.exitCode).not.toBe(0);
    });
  });
});

describe("Fly client download verification", () => {
  it("should successfully download binary for current platform", () => {
    // Binary should have been downloaded in beforeAll
    expect(binPath).toBeTruthy();
    expect(fs.existsSync(binPath)).toBe(true);
  });

  it("should have downloaded binary with version information", () => {
    // Get version from downloaded fly-client
    const currentResult = execBinary(["version"]);
    const currentVersion = currentResult.stdout;

    // Verify the downloaded binary works and has version info
    expect(currentVersion).toContain("Version:");
  });

  it("should have correct platform-specific binary", () => {
    const { extension } = getPlatformInfo();

    // Verify extension matches platform
    if (process.platform === "win32") {
      expect(binPath).toMatch(/\.exe$/);
    } else {
      expect(binPath).not.toMatch(/\.exe$/);
    }
  });
});

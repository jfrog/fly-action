// Copyright (c) JFrog Ltd. (2025)

/**
 * Integration tests for the Fly Client CLI.
 * These tests download the latest fly CLI binary from releases.jfrog.io
 * and verify that it is functional and accepts expected arguments.
 *
 * Note: These tests require network access to download the binary.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync, spawn, SpawnOptions } from "child_process";
import {
  SUPPORTED_PACKAGE_MANAGERS,
  PLATFORM_MAP,
  ARCH_MAP,
  FLY_CLI_DOWNLOAD_BASE,
} from "../constants";

let binPath: string;

/**
 * Downloads the fly CLI binary from releases.jfrog.io to a temp directory.
 * Uses the same URL pattern as the action's downloadFlyCLI function.
 */
async function downloadBinary(): Promise<string> {
  const osMapped = PLATFORM_MAP[process.platform];
  const archMapped = ARCH_MAP[process.arch];
  if (!osMapped || !archMapped) {
    throw new Error(
      `Unsupported platform/arch: ${process.platform}/${process.arch}`,
    );
  }

  const ext = process.platform === "win32" ? ".exe" : "";
  const binaryName = `fly${ext}`;
  const url = `${FLY_CLI_DOWNLOAD_BASE}/${osMapped}-${archMapped}/${binaryName}`;

  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "fly-integration-test-"),
  );
  const dest = path.join(tmpDir, binaryName);

  // Use curl for the download — available on all GitHub Actions runners and macOS/Linux
  execSync(`curl -fsSL -o "${dest}" "${url}"`, { timeout: 60000 });

  if (process.platform !== "win32") {
    fs.chmodSync(dest, 0o755);
  }

  return dest;
}

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

// Download binary once before all tests
beforeAll(async () => {
  binPath = await downloadBinary();
}, 120000); // 2 min timeout for download

describe("Fly Client Integration Tests", () => {
  describe("Fly client binary", () => {
    it("should be an executable file", () => {
      const stats = fs.statSync(binPath);
      expect(stats.isFile()).toBe(true);
      if (process.platform !== "win32") {
        expect(!!(stats.mode & fs.constants.X_OK)).toBe(true);
      }
    });

    it("should have reasonable file size (> 1MB)", () => {
      const stats = fs.statSync(binPath);
      expect(stats.size).toBeGreaterThan(1024 * 1024);
    });
  });

  describe("Version command", () => {
    it("should display version information with --version flag", () => {
      const result = execBinary(["--version"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+|[a-f0-9]+/i);
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

    it("should list available commands including upload and download", () => {
      const result = execBinary(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("setup");
      expect(result.stdout).toContain("status");
      expect(result.stdout).toContain("teardown");
      expect(result.stdout).toContain("version");
      expect(result.stdout).toContain("upload");
      expect(result.stdout).toContain("download");
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

      SUPPORTED_PACKAGE_MANAGERS.forEach((manager) => {
        expect(result.stdout.toLowerCase()).toContain(manager.toLowerCase());
      });

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
      const result = await spawnBinary(["setup", "npm"]);
      expect(result.exitCode).not.toBe(0);
    });

    it("should accept package manager arguments", async () => {
      const result = await spawnBinary(["setup", "npm", "pip", "maven"]);
      expect(result.exitCode).not.toBe(0);
    });

    it("should accept multiple package managers", async () => {
      const result = await spawnBinary([
        "setup",
        ...SUPPORTED_PACKAGE_MANAGERS,
        "docker",
        "podman",
        "helm",
      ]);
      expect(result.exitCode).not.toBe(0);
    });

    it("should accept --url flag", async () => {
      const result = await spawnBinary([
        "setup",
        "npm",
        "--url",
        "https://example.com",
      ]);
      expect(result.exitCode).not.toBe(0);
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

    SUPPORTED_PACKAGE_MANAGERS.forEach((manager) => {
      it(`should accept ${manager} as a valid package manager`, async () => {
        const result = await spawnBinary([
          "setup",
          manager,
          "--url",
          "https://test.example.com",
        ]);
        const combinedOutput = (result.stdout + result.stderr).toLowerCase();
        expect(combinedOutput).not.toContain("unknown package manager");
        expect(combinedOutput).not.toContain("invalid package manager");
        expect(combinedOutput).not.toContain(`unknown.*${manager}`);
      });
    });

    ["docker", "podman", "helm"].forEach((manager) => {
      it(`should accept ${manager} (container) as a valid package manager`, async () => {
        const result = await spawnBinary([
          "setup",
          manager,
          "--url",
          "https://test.example.com",
        ]);
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
      const combinedOutput = (result.stdout + result.stderr).toLowerCase();
      expect(combinedOutput).not.toContain("unknown package manager");
      expect(combinedOutput).not.toContain("invalid package manager");
      expect(combinedOutput).not.toContain("too many arguments");
    });

    it("should accept all package managers in the exact order the action sends them", async () => {
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
      const combinedOutput = (result.stdout + result.stderr).toLowerCase();
      expect(combinedOutput).not.toContain("duplicate");
    });
  });

  describe("Upload command", () => {
    it("should display upload help", () => {
      const result = execBinary(["upload", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Upload files to Fly generic storage");
      expect(result.stdout).toContain("FILE");
    });

    it("should list upload flags in help", () => {
      const result = execBinary(["upload", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--name");
      expect(result.stdout).toContain("--version");
      expect(result.stdout).toContain("--url");
      expect(result.stdout).toContain("--access-token");
      expect(result.stdout).toContain("--exclude");
    });

    it("should fail with clear error when no file arguments given", async () => {
      const result = await spawnBinary([
        "upload",
        "--name",
        "test-pkg",
        "--version",
        "1.0.0",
        "--url",
        "https://test.example.com",
        "--access-token",
        "fake-token",
      ]);
      expect(result.exitCode).not.toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toContain("file");
    });

    it("should require --name flag", async () => {
      const result = await spawnBinary([
        "upload",
        "--version",
        "1.0.0",
        "--url",
        "https://test.example.com",
        "somefile.txt",
      ]);
      expect(result.exitCode).not.toBe(0);
    });

    it("should require --version flag", async () => {
      const result = await spawnBinary([
        "upload",
        "--name",
        "test-pkg",
        "--url",
        "https://test.example.com",
        "somefile.txt",
      ]);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("Download command", () => {
    it("should display download help", () => {
      const result = execBinary(["download", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "Download files from Fly generic storage",
      );
      expect(result.stdout).toContain("FILE");
    });

    it("should list download flags in help", () => {
      const result = execBinary(["download", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--name");
      expect(result.stdout).toContain("--version");
      expect(result.stdout).toContain("--url");
      expect(result.stdout).toContain("--access-token");
      expect(result.stdout).toContain("--exclude");
      expect(result.stdout).toContain("--output-dir");
    });

    it("should fail with clear error when no filename arguments given", async () => {
      const result = await spawnBinary([
        "download",
        "--name",
        "test-pkg",
        "--version",
        "1.0.0",
        "--url",
        "https://test.example.com",
        "--access-token",
        "fake-token",
      ]);
      expect(result.exitCode).not.toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toContain("file");
    });

    it("should require --name flag", async () => {
      const result = await spawnBinary([
        "download",
        "--version",
        "1.0.0",
        "--url",
        "https://test.example.com",
        "somefile.txt",
      ]);
      expect(result.exitCode).not.toBe(0);
    });

    it("should require --version flag", async () => {
      const result = await spawnBinary([
        "download",
        "--name",
        "test-pkg",
        "--url",
        "https://test.example.com",
        "somefile.txt",
      ]);
      expect(result.exitCode).not.toBe(0);
    });

    it("should accept --output-dir flag", async () => {
      const result = await spawnBinary([
        "download",
        "--name",
        "test-pkg",
        "--version",
        "1.0.0",
        "--output-dir",
        "/tmp",
        "--url",
        "https://test.example.com",
        "--access-token",
        "fake-token",
        "somefile.txt",
      ]);
      // Will fail on auth, but should accept the flag without parsing errors
      const combined = (result.stdout + result.stderr).toLowerCase();
      expect(combined).not.toContain("invalid flag");
      expect(combined).not.toContain("unknown flag");
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
    expect(combinedOutput).not.toContain("executable file not found");
    expect(combinedOutput).not.toContain("not found in $PATH");
    expect(result.exitCode).not.toBe(0);
  });

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
      expect(combinedOutput).not.toContain("executable file not found");
      expect(combinedOutput).not.toContain("not found in $PATH");
      expect(result.exitCode).not.toBe(0);
    });
  });
});

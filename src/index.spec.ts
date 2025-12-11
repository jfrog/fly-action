// Copyright (c) JFrog Ltd. (2025)

// Mock modules before importing - preserve fs.promises for @actions/core
jest.mock("@actions/tool-cache");
jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    existsSync: jest.fn(),
    chmodSync: jest.fn(),
    mkdirSync: jest.fn(),
    renameSync: jest.fn(),
  };
});
jest.mock("path", () => {
  const actual = jest.requireActual("path");
  return {
    ...actual,
    join: jest.fn(),
  };
});

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import * as path from "path";
import { resolveFlyCLIBinaryPath, run } from "./index";
import { authenticateOidc } from "./oidc";
import {
  getAllPackageManagers,
  SUPPORTED_PACKAGE_MANAGERS,
} from "./package-detection";
import { STATE_FLY_URL, STATE_FLY_ACCESS_TOKEN } from "./constants";

jest.mock("./oidc", () => ({
  authenticateOidc: jest.fn(),
}));

jest.mock("./package-detection", () => ({
  getAllPackageManagers: jest.fn(),
  SUPPORTED_PACKAGE_MANAGERS: [
    "npm",
    "pnpm",
    "pip",
    "pipenv",
    "twine",
    "maven",
    "gradle",
    "dotnet",
    "nuget",
    "go",
  ],
}));

// Helper to mock platform and arch
const mockPlatform = (platform: string, arch: string) => {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  Object.defineProperty(process, "arch", {
    value: arch,
    configurable: true,
  });
};

describe("getPlatformInfo", () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  afterEach(() => {
    mockPlatform(originalPlatform, originalArch);
    jest.resetAllMocks();
  });

  it("maps darwin x64 correctly", async () => {
    mockPlatform("darwin", "x64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.chmodSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await resolveFlyCLIBinaryPath();

    expect(tc.downloadTool).toHaveBeenCalledWith(
      expect.stringContaining("darwin-amd64/fly"),
    );
  });

  it("maps darwin arm64 correctly", async () => {
    mockPlatform("darwin", "arm64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.chmodSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await resolveFlyCLIBinaryPath();

    expect(tc.downloadTool).toHaveBeenCalledWith(
      expect.stringContaining("darwin-arm64/fly"),
    );
  });

  it("maps linux x64 correctly", async () => {
    mockPlatform("linux", "x64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.chmodSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await resolveFlyCLIBinaryPath();

    expect(tc.downloadTool).toHaveBeenCalledWith(
      expect.stringContaining("linux-amd64/fly"),
    );
  });

  it("maps win32 x64 correctly with .exe extension", async () => {
    mockPlatform("win32", "x64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly.exe");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await resolveFlyCLIBinaryPath();

    expect(tc.downloadTool).toHaveBeenCalledWith(
      expect.stringContaining("windows-amd64/fly.exe"),
    );
    expect(fs.chmodSync).not.toHaveBeenCalled();
  });

  it("throws error for unsupported platform", async () => {
    mockPlatform("freebsd", "x64");

    await expect(resolveFlyCLIBinaryPath()).rejects.toThrow(
      "Unsupported platform: freebsd",
    );
  });

  it("throws error for unsupported architecture", async () => {
    mockPlatform("linux", "ia32");

    await expect(resolveFlyCLIBinaryPath()).rejects.toThrow(
      "Unsupported architecture: ia32",
    );
  });
});

describe("findCachedBinary", () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  beforeEach(() => {
    mockPlatform(originalPlatform, originalArch);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("returns cached binary path when found", async () => {
    mockPlatform("darwin", "arm64");
    (tc.find as jest.Mock).mockReturnValue("/cached/fly-client/latest");
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockReturnValue("/cached/fly-client/latest/fly");

    const result = await resolveFlyCLIBinaryPath();

    expect(result).toBe("/cached/fly-client/latest/fly");
    expect(tc.downloadTool).not.toHaveBeenCalled();
  });

  it("downloads when cache is not found", async () => {
    mockPlatform("linux", "x64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.chmodSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await resolveFlyCLIBinaryPath();

    expect(tc.downloadTool).toHaveBeenCalled();
    expect(tc.cacheDir).toHaveBeenCalled();
  });

  it("re-downloads when cached path exists but binary does not", async () => {
    mockPlatform("darwin", "x64");
    (tc.find as jest.Mock).mockReturnValue("/cached/fly-client");
    (fs.existsSync as jest.Mock)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/new-cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.chmodSync as jest.Mock).mockReturnValue(undefined);
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await resolveFlyCLIBinaryPath();

    expect(tc.downloadTool).toHaveBeenCalled();
  });
});

describe("downloadBinary", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it("downloads from correct URL with [RELEASE]", async () => {
    mockPlatform("linux", "arm64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.chmodSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await resolveFlyCLIBinaryPath();

    expect(tc.downloadTool).toHaveBeenCalledWith(
      expect.stringContaining("[RELEASE]/linux-arm64/fly"),
    );
    expect(tc.downloadTool).toHaveBeenCalledWith(
      expect.stringContaining("releases.jfrog.io/artifactory/fly-client/v1"),
    );
  });

  it("throws error when download fails", async () => {
    mockPlatform("darwin", "arm64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockRejectedValue(
      new Error("Network error"),
    );
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await expect(resolveFlyCLIBinaryPath()).rejects.toThrow(
      "Failed to download from",
    );
  });
});

describe("prepareBinary", () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  beforeEach(() => {
    mockPlatform(originalPlatform, originalArch);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("sets executable permissions on Unix systems", async () => {
    mockPlatform("linux", "x64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.chmodSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await resolveFlyCLIBinaryPath();

    expect(fs.chmodSync).toHaveBeenCalledWith(expect.any(String), 0o755);
  });

  it("does not set permissions on Windows", async () => {
    mockPlatform("win32", "x64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly.exe");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await resolveFlyCLIBinaryPath();

    expect(fs.chmodSync).not.toHaveBeenCalled();
  });

  it("caches the binary with correct parameters", async () => {
    mockPlatform("darwin", "arm64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.chmodSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));

    await resolveFlyCLIBinaryPath();

    expect(tc.cacheDir).toHaveBeenCalledWith(
      expect.any(String),
      "fly-client",
      "latest",
      "darwin-arm64",
    );
  });
});

describe("resolveFlyCLIBinaryPath", () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  beforeEach(() => {
    mockPlatform(originalPlatform, originalArch);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("returns path after successful download and cache", async () => {
    mockPlatform("darwin", "arm64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.chmodSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockReturnValue("/cached/fly-client/fly");

    const result = await resolveFlyCLIBinaryPath();

    expect(result).toBe("/cached/fly-client/fly");
  });

  it("throws error if binary does not exist after download", async () => {
    mockPlatform("linux", "x64");
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockResolvedValue("/tmp/fly");
    (tc.cacheDir as jest.Mock).mockResolvedValue("/cached/fly-client");
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.renameSync as jest.Mock).mockReturnValue(undefined);
    (fs.chmodSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (path.join as jest.Mock).mockReturnValue("/cached/fly-client/fly");

    await expect(resolveFlyCLIBinaryPath()).rejects.toThrow(
      "Fly CLI binary not found at /cached/fly-client/fly after download",
    );
  });
});

describe("run", () => {
  const getInputSpy = jest.spyOn(core, "getInput");
  const setFailedSpy = jest.spyOn(core, "setFailed");
  const setSecretSpy = jest.spyOn(core, "setSecret");
  const saveStateSpy = jest.spyOn(core, "saveState");
  const execSpy = jest.spyOn(exec, "exec");
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  beforeEach(() => {
    mockPlatform(originalPlatform, originalArch);
    jest.resetAllMocks();
    // Stub binary download and cache
    (tc.find as jest.Mock).mockReturnValue("/cached/fly-client");
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.join as jest.Mock).mockReturnValue("/cached/fly-client/fly");
    // Default: return all supported package managers
    (getAllPackageManagers as jest.Mock).mockResolvedValue([
      ...SUPPORTED_PACKAGE_MANAGERS,
    ]);
  });

  it("runs successfully when exec returns 0", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "https://url" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "user",
      accessToken: "token",
    });
    execSpy.mockResolvedValue(0);

    await run();

    expect(authenticateOidc).toHaveBeenCalledWith("https://url");
    expect(setSecretSpy).toHaveBeenCalledWith("token");
    expect(saveStateSpy).toHaveBeenCalledWith(STATE_FLY_URL, "https://url");
    expect(saveStateSpy).toHaveBeenCalledWith(STATE_FLY_ACCESS_TOKEN, "token");
    expect(execSpy).toHaveBeenCalled();
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it("calls setFailed on non-zero exit code", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "u" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "u",
      accessToken: "t",
    });
    execSpy.mockResolvedValue(1);

    await run();

    expect(saveStateSpy).toHaveBeenCalledWith("fly-url", "u");
    expect(saveStateSpy).toHaveBeenCalledWith("fly-access-token", "t");
    expect(setFailedSpy).toHaveBeenCalledWith("Fly setup command failed");
  });

  it("calls setFailed on exception", async () => {
    getInputSpy.mockImplementation(() => "x");
    (authenticateOidc as jest.Mock).mockRejectedValue(new Error("oidc fail"));

    await run();

    expect(setFailedSpy).toHaveBeenCalledWith("oidc fail");
    expect(saveStateSpy).not.toHaveBeenCalled();
  });

  it("passes ignore input to environment variables", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "u" : "docker",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "u",
      accessToken: "t",
    });
    execSpy.mockImplementation(
      async (_bin: string, _args?: string[], options?: exec.ExecOptions) => {
        const env = options?.env;
        expect(env?.FLY_IGNORE_PACKAGE_MANAGERS).toBe("docker");
        return 0;
      },
    );

    await run();
    expect(saveStateSpy).toHaveBeenCalledWith("fly-url", "u");
    expect(saveStateSpy).toHaveBeenCalledWith("fly-access-token", "t");
  });

  it("handles non-Error exceptions with unknown error message", async () => {
    getInputSpy.mockImplementation(() => "u");
    (authenticateOidc as jest.Mock).mockRejectedValue("failString");

    await run();
    expect(setFailedSpy).toHaveBeenCalledWith("An unknown error occurred");
  });

  it("passes all package managers to fly CLI", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "https://test.com" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "user",
      accessToken: "token",
    });
    (getAllPackageManagers as jest.Mock).mockResolvedValue([
      ...SUPPORTED_PACKAGE_MANAGERS,
      "docker",
      "helm",
    ]);
    execSpy.mockResolvedValue(0);

    await run();

    expect(execSpy).toHaveBeenCalledWith(
      "/cached/fly-client/fly",
      ["setup", ...SUPPORTED_PACKAGE_MANAGERS, "docker", "helm"],
      expect.objectContaining({
        env: expect.objectContaining({
          FLY_URL: "https://test.com",
          FLY_ACCESS_TOKEN: "token",
        }),
      }),
    );
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it("handles download failure gracefully", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "https://url" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "user",
      accessToken: "token",
    });
    (tc.find as jest.Mock).mockReturnValue("");
    (tc.downloadTool as jest.Mock).mockRejectedValue(
      new Error("Network error"),
    );

    await run();

    expect(setFailedSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to download from"),
    );
  });
});

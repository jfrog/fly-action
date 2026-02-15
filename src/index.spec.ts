// Copyright (c) JFrog Ltd. (2025)

// Mock fs and path modules
jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return { ...actual, existsSync: jest.fn(), chmodSync: jest.fn() };
});
jest.mock("path", () => {
  const actual = jest.requireActual("path");
  return { ...actual, resolve: jest.fn() };
});

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { resolveFlyCLIBinaryPath, run } from "./index";
import { authenticateOidc } from "./oidc";
import {
  detectPackageManagers,
  getAllPackageManagers,
  SUPPORTED_PACKAGE_MANAGERS,
} from "./package-detection";
import {
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  ENV_FLY_ACTION_CONFIGURED,
} from "./constants";

jest.mock("./oidc", () => ({
  authenticateOidc: jest.fn(),
}));

jest.mock("./package-detection", () => ({
  detectPackageManagers: jest.fn(),
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

describe("resolveFlyCLIBinaryPath", () => {
  afterEach(() => jest.resetAllMocks());

  it("returns resolved path when binary exists and sets permissions", () => {
    const fakePath = "/fake/bin";
    (path.resolve as jest.Mock).mockReturnValue(fakePath);
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const result = resolveFlyCLIBinaryPath();
    expect(result).toBe(fakePath);
    expect(fs.chmodSync as jest.Mock).toHaveBeenCalledWith(fakePath, 0o755);
  });

  it("throws error when binary does not exist", () => {
    (path.resolve as jest.Mock).mockReturnValue("/fake/bin");
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    expect(() => resolveFlyCLIBinaryPath()).toThrow(
      `Fly CLI binary not found at /fake/bin for ${process.platform}/${process.arch}. Ensure it is present in the 'bin' directory of the action.`,
    );
  });
});

describe("resolveFlyCLIBinaryPath Windows behavior", () => {
  it("does not chmod on win32 platform", () => {
    // Temporarily override platform
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    (path.resolve as jest.Mock).mockReturnValue("/fake/win/bin");
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const result = resolveFlyCLIBinaryPath();
    expect(result).toBe("/fake/win/bin");
    // chmod should not be called
    expect(fs.chmodSync as jest.Mock).not.toHaveBeenCalled();

    // Restore platform
    Object.defineProperty(process, "platform", { value: origPlatform });
  });
});

describe("run", () => {
  const getInputSpy = jest.spyOn(core, "getInput");
  const setFailedSpy = jest.spyOn(core, "setFailed");
  const setSecretSpy = jest.spyOn(core, "setSecret");
  const saveStateSpy = jest.spyOn(core, "saveState");
  const execSpy = jest.spyOn(exec, "exec");

  beforeEach(() => {
    jest.resetAllMocks();
    // Clear idempotency env var so run() doesn't skip execution
    delete process.env[ENV_FLY_ACTION_CONFIGURED];
    // Stub file system to simulate binary present
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.resolve as jest.Mock).mockReturnValue("/fake/bin");
    // Default: detectPackageManagers returns empty (no package managers detected)
    (detectPackageManagers as jest.Mock).mockReturnValue([]);
    // Default: getAllPackageManagers returns all supported (no container managers detected)
    (getAllPackageManagers as jest.Mock).mockReturnValue([
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
    // No state should be saved when authentication fails
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
        // check ignore env var passed
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
    // reject with non-Error
    (authenticateOidc as jest.Mock).mockRejectedValue("failString");

    await run();
    expect(setFailedSpy).toHaveBeenCalledWith("An unknown error occurred");
  });

  it("calls fly setup without package manager arguments", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "https://test.com" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "user",
      accessToken: "token",
    });
    // Simulate detected package managers (for EndCI reporting)
    (detectPackageManagers as jest.Mock).mockReturnValue([
      "npm",
      "docker",
      "go",
    ]);
    execSpy.mockResolvedValue(0);

    await run();

    // Should call exec with just "setup" (no package manager arguments)
    expect(execSpy).toHaveBeenCalledWith(
      "/fake/bin",
      ["setup"],
      expect.objectContaining({
        env: expect.objectContaining({
          FLY_URL: "https://test.com",
          FLY_ACCESS_TOKEN: "token",
        }),
      }),
    );
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it("saves detected package managers to state for EndCI reporting", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "https://test.com" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "user",
      accessToken: "token",
    });
    // Detected package managers (for EndCI reporting)
    (detectPackageManagers as jest.Mock).mockReturnValue([
      "npm",
      "docker",
      "helm",
    ]);
    execSpy.mockResolvedValue(0);

    await run();

    // Should save detected package managers to state
    expect(saveStateSpy).toHaveBeenCalledWith(
      "fly-package-managers",
      JSON.stringify(["npm", "docker", "helm"]),
    );
    // Should call exec with just "setup"
    expect(execSpy).toHaveBeenCalledWith(
      "/fake/bin",
      ["setup"],
      expect.objectContaining({
        env: expect.objectContaining({
          FLY_URL: "https://test.com",
          FLY_ACCESS_TOKEN: "token",
        }),
      }),
    );
    expect(setFailedSpy).not.toHaveBeenCalled();
  });
});

describe("run exec and binary error branches", () => {
  const getInputSpy = jest.spyOn(core, "getInput");
  const setFailedSpy = jest.spyOn(core, "setFailed");
  const execSpy = jest.spyOn(exec, "exec");

  beforeEach(() => {
    jest.resetAllMocks();
    // Clear idempotency env var so run() doesn't skip execution
    delete process.env[ENV_FLY_ACTION_CONFIGURED];
    // default auth ok
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "url" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "u",
      accessToken: "t",
    });
    // Default: return all supported package managers
    (getAllPackageManagers as jest.Mock).mockResolvedValue([
      ...SUPPORTED_PACKAGE_MANAGERS,
    ]);
  });

  it("calls setFailed when exec throws error", async () => {
    // stub binary present
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.resolve as jest.Mock).mockReturnValue("/fake/bin");
    execSpy.mockRejectedValue(new Error("exec error"));

    await run();
    expect(setFailedSpy).toHaveBeenCalledWith("exec error");
  });

  it("calls setFailed when binary is missing", async () => {
    // stub no binary
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (path.resolve as jest.Mock).mockReturnValue("/test/path/fly-darwin-arm64"); // Mock path.resolve to provide a concrete path for the error message
    getInputSpy.mockImplementation(() => "");

    await run();
    expect(setFailedSpy).toHaveBeenCalledWith(
      `Fly CLI binary not found at /test/path/fly-darwin-arm64 for ${process.platform}/${process.arch}. Ensure it is present in the 'bin' directory of the action.`,
    );
  });
});

describe("run idempotency", () => {
  const getInputSpy = jest.spyOn(core, "getInput");
  const setFailedSpy = jest.spyOn(core, "setFailed");
  const saveStateSpy = jest.spyOn(core, "saveState");
  const exportVariableSpy = jest.spyOn(core, "exportVariable");
  const infoSpy = jest.spyOn(core, "info");
  const execSpy = jest.spyOn(exec, "exec");

  beforeEach(() => {
    jest.resetAllMocks();
    // Remove the env var before each test
    delete process.env[ENV_FLY_ACTION_CONFIGURED];
    // Stub file system to simulate binary present
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.resolve as jest.Mock).mockReturnValue("/fake/bin");
    (detectPackageManagers as jest.Mock).mockReturnValue([]);
  });

  afterEach(() => {
    // Clean up env var after tests
    delete process.env[ENV_FLY_ACTION_CONFIGURED];
  });

  it("skips execution when FLY_ACTION_CONFIGURED is already set", async () => {
    // Set the env var to simulate action already ran
    process.env[ENV_FLY_ACTION_CONFIGURED] = "true";

    await run();

    // Should log skip message
    expect(infoSpy).toHaveBeenCalledWith(
      "Fly action has already been configured in this job, skipping duplicate run.",
    );
    // Should NOT call authentication or exec
    expect(authenticateOidc).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
    // Should NOT save state
    expect(saveStateSpy).not.toHaveBeenCalled();
    // Should NOT set failed
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it("exports FLY_ACTION_CONFIGURED after successful run", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "https://test.com" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "user",
      accessToken: "token",
    });
    execSpy.mockResolvedValue(0);

    await run();

    // Should export the env var
    expect(exportVariableSpy).toHaveBeenCalledWith(
      ENV_FLY_ACTION_CONFIGURED,
      "true",
    );
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it("does not export FLY_ACTION_CONFIGURED when setup fails", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "https://test.com" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "user",
      accessToken: "token",
    });
    execSpy.mockResolvedValue(1); // Non-zero exit code

    await run();

    // Should NOT export the env var on failure
    expect(exportVariableSpy).not.toHaveBeenCalledWith(
      ENV_FLY_ACTION_CONFIGURED,
      "true",
    );
    expect(setFailedSpy).toHaveBeenCalled();
  });
});

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
import { resolveFlyCLIBinaryPath, resolveOidcUrl, run } from "./index";
import { authenticateOidc } from "./oidc";
import {
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  ENV_FLY_ACTION_CONFIGURED,
  ENV_FLY_REGISTRY_SUBDOMAIN,
  ENV_FLY_URL,
  DEFAULT_FLY_URL,
} from "./constants";

// Test-only dummy values (not real credentials)
const MOCK_TOKEN = `test-${"access"}-tok`;

jest.mock("./oidc", () => ({
  authenticateOidc: jest.fn(),
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

describe("resolveOidcUrl", () => {
  const getInputSpy = jest.spyOn(core, "getInput");

  afterEach(() => {
    jest.resetAllMocks();
    delete process.env[ENV_FLY_URL];
    delete process.env.GITHUB_SERVER_URL;
  });

  it("returns explicit url input when provided (deprecated path)", () => {
    getInputSpy.mockReturnValue("https://explicit.jfrog.io");
    const result = resolveOidcUrl();
    expect(result).toBe("https://explicit.jfrog.io");
  });

  it("returns FLY_URL env var when set and no input", () => {
    getInputSpy.mockReturnValue("");
    process.env[ENV_FLY_URL] = "https://fly.jfrog.info";
    const result = resolveOidcUrl();
    expect(result).toBe("https://fly.jfrog.info");
  });

  it("returns default fly.jfrog.ai on github.com", () => {
    getInputSpy.mockReturnValue("");
    process.env.GITHUB_SERVER_URL = "https://github.com";
    const result = resolveOidcUrl();
    expect(result).toBe(DEFAULT_FLY_URL);
  });

  it("returns default fly.jfrog.ai when GITHUB_SERVER_URL is not set", () => {
    getInputSpy.mockReturnValue("");
    delete process.env.GITHUB_SERVER_URL;
    const result = resolveOidcUrl();
    expect(result).toBe(DEFAULT_FLY_URL);
  });

  it("throws on GHES when FLY_URL is not set", () => {
    getInputSpy.mockReturnValue("");
    process.env.GITHUB_SERVER_URL = "https://github.jfrog.info";
    expect(() => resolveOidcUrl()).toThrow(
      "GitHub Enterprise Server detected (https://github.jfrog.info)",
    );
  });

  it("uses FLY_URL on GHES when set", () => {
    getInputSpy.mockReturnValue("");
    process.env.GITHUB_SERVER_URL = "https://github.jfrog.info";
    process.env[ENV_FLY_URL] = "https://fly.jfrog.info";
    const result = resolveOidcUrl();
    expect(result).toBe("https://fly.jfrog.info");
  });

  it("prefers explicit url input over FLY_URL env var", () => {
    getInputSpy.mockReturnValue("https://explicit.jfrog.io");
    process.env[ENV_FLY_URL] = "https://fly.jfrog.info";
    const result = resolveOidcUrl();
    expect(result).toBe("https://explicit.jfrog.io");
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
  });

  it("runs successfully when exec returns 0", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "https://url" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
    });
    execSpy.mockResolvedValue(0);

    await run();

    expect(authenticateOidc).toHaveBeenCalledWith("https://url");
    expect(setSecretSpy).toHaveBeenCalledWith(MOCK_TOKEN);
    expect(saveStateSpy).toHaveBeenCalledWith(
      STATE_FLY_URL,
      "https://resolved-tenant.jfrog.io",
    );
    expect(saveStateSpy).toHaveBeenCalledWith(
      STATE_FLY_ACCESS_TOKEN,
      MOCK_TOKEN,
    );
    expect(execSpy).toHaveBeenCalled();
    expect(setFailedSpy).not.toHaveBeenCalled();
  });

  it("exports FLY_REGISTRY_SUBDOMAIN env var on success", async () => {
    const exportVariableSpy = jest.spyOn(core, "exportVariable");
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "https://url" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
    });
    execSpy.mockResolvedValue(0);

    await run();

    expect(exportVariableSpy).toHaveBeenCalledWith(
      ENV_FLY_REGISTRY_SUBDOMAIN,
      "resolved-tenant.jfrog.io",
    );
  });

  it("calls setFailed on non-zero exit code", async () => {
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "u" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      accessToken: "t",
      flyTenantUrl: "https://tenant.jfrog.io",
    });
    execSpy.mockResolvedValue(1);

    await run();

    expect(saveStateSpy).toHaveBeenCalledWith(
      "fly-url",
      "https://tenant.jfrog.io",
    );
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
      accessToken: "t",
      flyTenantUrl: "https://tenant.jfrog.io",
    });
    execSpy.mockImplementation(
      async (_bin: string, _args?: string[], options?: exec.ExecOptions) => {
        const env = options?.env;
        expect(env?.FLY_IGNORE_PACKAGE_MANAGERS).toBe("docker");
        return 0;
      },
    );

    await run();
    expect(saveStateSpy).toHaveBeenCalledWith(
      "fly-url",
      "https://tenant.jfrog.io",
    );
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
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
    });
    execSpy.mockResolvedValue(0);

    await run();

    expect(execSpy).toHaveBeenCalledWith(
      "/fake/bin",
      ["setup"],
      expect.objectContaining({
        env: expect.objectContaining({
          FLY_URL: "https://resolved-tenant.jfrog.io",
          FLY_ACCESS_TOKEN: MOCK_TOKEN,
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
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "url" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      accessToken: "t",
      flyTenantUrl: "https://tenant.jfrog.io",
    });
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
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
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
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
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

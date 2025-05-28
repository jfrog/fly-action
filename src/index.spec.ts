// Mock fs and path modules
jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return { ...actual, existsSync: jest.fn(), chmodSync: jest.fn() };
});
jest.mock("path", () => {
  const actual = jest.requireActual("path");
  return { ...actual, resolve: jest.fn() };
});

import { resolveFlyFrogCLIBinaryPath, run } from "./index";
import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { authenticateOidc } from "./oidc";

jest.mock("./oidc", () => ({
  authenticateOidc: jest.fn(),
}));

describe("resolveFlyFrogCLIBinaryPath", () => {
  afterEach(() => jest.resetAllMocks());

  it("returns resolved path when binary exists and sets permissions", () => {
    const fakePath = "/fake/bin";
    (path.resolve as jest.Mock).mockReturnValue(fakePath);
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const result = resolveFlyFrogCLIBinaryPath();
    expect(result).toBe(fakePath);
    expect(fs.chmodSync as jest.Mock).toHaveBeenCalledWith(fakePath, 0o755);
  });

  it("throws error when binary does not exist", () => {
    (path.resolve as jest.Mock).mockReturnValue("/fake/bin");
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    expect(() => resolveFlyFrogCLIBinaryPath()).toThrow(
      `Binary not found for ${process.platform}/${process.arch}`,
    );
  });
});

describe("resolveFlyFrogCLIBinaryPath Windows behavior", () => {
  it("does not chmod on win32 platform", () => {
    // Temporarily override platform
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    (path.resolve as jest.Mock).mockReturnValue("/fake/win/bin");
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const result = resolveFlyFrogCLIBinaryPath();
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
  const infoSpy = jest.spyOn(core, "info");
  const noticeSpy = jest.spyOn(core, "notice");
  const errorSpy = jest.spyOn(core, "error");
  const setSecretSpy = jest.spyOn(core, "setSecret");
  const saveStateSpy = jest.spyOn(core, "saveState");
  const execSpy = jest.spyOn(exec, "exec");

  beforeEach(() => {
    jest.resetAllMocks();
    // Stub file system to simulate binary present
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (path.resolve as jest.Mock).mockReturnValue("/fake/bin");
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
    expect(saveStateSpy).toHaveBeenCalledWith("flyfrog-url", "https://url");
    expect(saveStateSpy).toHaveBeenCalledWith("flyfrog-access-token", "token");
    expect(infoSpy).toHaveBeenCalledWith(
      "✅ Successfully authenticated with OIDC",
    );
    expect(execSpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      "🎉 FlyFrog registry configuration completed successfully",
    );
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

    expect(saveStateSpy).toHaveBeenCalledWith("flyfrog-url", "u");
    expect(saveStateSpy).toHaveBeenCalledWith("flyfrog-access-token", "t");
    expect(setFailedSpy).toHaveBeenCalledWith("FlyFrog setup command failed");
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
        expect(env?.FLYFROG_IGNORE_PACKAGE_MANAGERS).toBe("docker");
        return 0;
      },
    );

    await run();
    expect(saveStateSpy).toHaveBeenCalledWith("flyfrog-url", "u");
    expect(saveStateSpy).toHaveBeenCalledWith("flyfrog-access-token", "t");
  });

  it("handles non-Error exceptions with unknown error message", async () => {
    getInputSpy.mockImplementation(() => "u");
    // reject with non-Error
    (authenticateOidc as jest.Mock).mockRejectedValue("failString");

    await run();
    expect(setFailedSpy).toHaveBeenCalledWith("An unknown error occurred");
  });
});

describe("run exec and binary error branches", () => {
  const getInputSpy = jest.spyOn(core, "getInput");
  const setFailedSpy = jest.spyOn(core, "setFailed");
  const execSpy = jest.spyOn(exec, "exec");

  beforeEach(() => {
    jest.resetAllMocks();
    // default auth ok
    getInputSpy.mockImplementation((name: string) =>
      name === "url" ? "url" : "",
    );
    (authenticateOidc as jest.Mock).mockResolvedValue({
      user: "u",
      accessToken: "t",
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
    getInputSpy.mockImplementation(() => "");

    await run();
    expect(setFailedSpy).toHaveBeenCalledWith(
      expect.stringContaining("Binary not found"),
    );
  });
});

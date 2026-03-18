// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";

// Mock modules — vi.mock calls are hoisted
vi.mock("@actions/core");
vi.mock("@actions/exec");
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, existsSync: vi.fn(), chmodSync: vi.fn() };
});
vi.mock("path", async () => {
  const actual = await vi.importActual<typeof import("path")>("path");
  return { ...actual, resolve: vi.fn() };
});
vi.mock("./oidc", () => ({
  authenticateOidc: vi.fn(),
}));

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

describe("resolveFlyCLIBinaryPath", () => {
  afterEach(() => vi.resetAllMocks());

  it("returns resolved path when binary exists and sets permissions", () => {
    const fakePath = "/fake/bin";
    (path.resolve as Mock).mockReturnValue(fakePath);
    (fs.existsSync as Mock).mockReturnValue(true);

    const result = resolveFlyCLIBinaryPath();
    expect(result).toBe(fakePath);
    expect(fs.chmodSync as Mock).toHaveBeenCalledWith(fakePath, 0o755);
  });

  it("throws error when binary does not exist", () => {
    (path.resolve as Mock).mockReturnValue("/fake/bin");
    (fs.existsSync as Mock).mockReturnValue(false);

    expect(() => resolveFlyCLIBinaryPath()).toThrow(
      `Fly CLI binary not found at /fake/bin for ${process.platform}/${process.arch}. Ensure it is present in the 'bin' directory of the action.`,
    );
  });
});

describe("resolveFlyCLIBinaryPath Windows behavior", () => {
  it("does not chmod on win32 platform", () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    (path.resolve as Mock).mockReturnValue("/fake/win/bin");
    (fs.existsSync as Mock).mockReturnValue(true);

    const result = resolveFlyCLIBinaryPath();
    expect(result).toBe("/fake/win/bin");
    expect(fs.chmodSync as Mock).not.toHaveBeenCalled();

    Object.defineProperty(process, "platform", { value: origPlatform });
  });
});

describe("resolveOidcUrl", () => {
  afterEach(() => {
    vi.resetAllMocks();
    delete process.env[ENV_FLY_URL];
    delete process.env.GITHUB_SERVER_URL;
  });

  it("returns explicit url input when provided (deprecated path)", () => {
    vi.mocked(core.getInput).mockReturnValue("https://explicit.jfrog.io");
    const result = resolveOidcUrl();
    expect(result).toBe("https://explicit.jfrog.io");
  });

  it("returns FLY_URL env var when set and no input", () => {
    vi.mocked(core.getInput).mockReturnValue("");
    process.env[ENV_FLY_URL] = "https://fly.jfrog.info";
    const result = resolveOidcUrl();
    expect(result).toBe("https://fly.jfrog.info");
  });

  it("returns default fly.jfrog.ai on github.com", () => {
    vi.mocked(core.getInput).mockReturnValue("");
    process.env.GITHUB_SERVER_URL = "https://github.com";
    const result = resolveOidcUrl();
    expect(result).toBe(DEFAULT_FLY_URL);
  });

  it("returns default fly.jfrog.ai when GITHUB_SERVER_URL is not set", () => {
    vi.mocked(core.getInput).mockReturnValue("");
    delete process.env.GITHUB_SERVER_URL;
    const result = resolveOidcUrl();
    expect(result).toBe(DEFAULT_FLY_URL);
  });

  it("throws on GHES when FLY_URL is not set", () => {
    vi.mocked(core.getInput).mockReturnValue("");
    process.env.GITHUB_SERVER_URL = "https://github.jfrog.info";
    expect(() => resolveOidcUrl()).toThrow(
      "GitHub Enterprise Server detected (https://github.jfrog.info)",
    );
  });

  it("uses FLY_URL on GHES when set", () => {
    vi.mocked(core.getInput).mockReturnValue("");
    process.env.GITHUB_SERVER_URL = "https://github.jfrog.info";
    process.env[ENV_FLY_URL] = "https://fly.jfrog.info";
    const result = resolveOidcUrl();
    expect(result).toBe("https://fly.jfrog.info");
  });

  it("prefers explicit url input over FLY_URL env var", () => {
    vi.mocked(core.getInput).mockReturnValue("https://explicit.jfrog.io");
    process.env[ENV_FLY_URL] = "https://fly.jfrog.info";
    const result = resolveOidcUrl();
    expect(result).toBe("https://explicit.jfrog.io");
  });
});

describe("run", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env[ENV_FLY_ACTION_CONFIGURED];
    (fs.existsSync as Mock).mockReturnValue(true);
    (path.resolve as Mock).mockReturnValue("/fake/bin");
  });

  it("runs successfully when exec returns 0", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "url" ? "https://url" : "",
    );
    (authenticateOidc as Mock).mockResolvedValue({
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
    });
    vi.mocked(exec.exec).mockResolvedValue(0);

    await run();

    expect(authenticateOidc).toHaveBeenCalledWith("https://url");
    expect(core.setSecret).toHaveBeenCalledWith(MOCK_TOKEN);
    expect(core.saveState).toHaveBeenCalledWith(
      STATE_FLY_URL,
      "https://resolved-tenant.jfrog.io",
    );
    expect(core.saveState).toHaveBeenCalledWith(
      STATE_FLY_ACCESS_TOKEN,
      MOCK_TOKEN,
    );
    expect(exec.exec).toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("exports FLY_REGISTRY_SUBDOMAIN env var on success", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "url" ? "https://url" : "",
    );
    (authenticateOidc as Mock).mockResolvedValue({
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
    });
    vi.mocked(exec.exec).mockResolvedValue(0);

    await run();

    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_REGISTRY_SUBDOMAIN,
      "resolved-tenant.jfrog.io",
    );
  });

  it("calls setFailed on non-zero exit code", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "url" ? "u" : "",
    );
    (authenticateOidc as Mock).mockResolvedValue({
      accessToken: "t",
      flyTenantUrl: "https://tenant.jfrog.io",
    });
    vi.mocked(exec.exec).mockResolvedValue(1);

    await run();

    expect(core.saveState).toHaveBeenCalledWith(
      "fly-url",
      "https://tenant.jfrog.io",
    );
    expect(core.saveState).toHaveBeenCalledWith("fly-access-token", "t");
    expect(core.setFailed).toHaveBeenCalledWith("Fly setup command failed");
  });

  it("calls setFailed on exception", async () => {
    vi.mocked(core.getInput).mockImplementation(() => "x");
    (authenticateOidc as Mock).mockRejectedValue(new Error("oidc fail"));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith("oidc fail");
    expect(core.saveState).not.toHaveBeenCalled();
  });

  it("passes ignore input to environment variables", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "url" ? "u" : "docker",
    );
    (authenticateOidc as Mock).mockResolvedValue({
      accessToken: "t",
      flyTenantUrl: "https://tenant.jfrog.io",
    });
    vi.mocked(exec.exec).mockImplementation(
      async (_bin: string, _args?: string[], options?: exec.ExecOptions) => {
        const env = options?.env;
        expect(env?.FLY_IGNORE_PACKAGE_MANAGERS).toBe("docker");
        return 0;
      },
    );

    await run();
    expect(core.saveState).toHaveBeenCalledWith(
      "fly-url",
      "https://tenant.jfrog.io",
    );
    expect(core.saveState).toHaveBeenCalledWith("fly-access-token", "t");
  });

  it("handles non-Error exceptions with unknown error message", async () => {
    vi.mocked(core.getInput).mockImplementation(() => "u");
    (authenticateOidc as Mock).mockRejectedValue("failString");

    await run();
    expect(core.setFailed).toHaveBeenCalledWith("An unknown error occurred");
  });

  it("calls fly setup without package manager arguments", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "url" ? "https://test.com" : "",
    );
    (authenticateOidc as Mock).mockResolvedValue({
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
    });
    vi.mocked(exec.exec).mockResolvedValue(0);

    await run();

    expect(exec.exec).toHaveBeenCalledWith(
      "/fake/bin",
      ["setup"],
      expect.objectContaining({
        env: expect.objectContaining({
          FLY_URL: "https://resolved-tenant.jfrog.io",
          FLY_ACCESS_TOKEN: MOCK_TOKEN,
        }),
      }),
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});

describe("run exec and binary error branches", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env[ENV_FLY_ACTION_CONFIGURED];
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "url" ? "url" : "",
    );
    (authenticateOidc as Mock).mockResolvedValue({
      accessToken: "t",
      flyTenantUrl: "https://tenant.jfrog.io",
    });
  });

  it("calls setFailed when exec throws error", async () => {
    (fs.existsSync as Mock).mockReturnValue(true);
    (path.resolve as Mock).mockReturnValue("/fake/bin");
    vi.mocked(exec.exec).mockRejectedValue(new Error("exec error"));

    await run();
    expect(core.setFailed).toHaveBeenCalledWith("exec error");
  });

  it("calls setFailed when binary is missing", async () => {
    (fs.existsSync as Mock).mockReturnValue(false);
    (path.resolve as Mock).mockReturnValue("/test/path/fly-darwin-arm64");
    vi.mocked(core.getInput).mockImplementation(() => "");

    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      `Fly CLI binary not found at /test/path/fly-darwin-arm64 for ${process.platform}/${process.arch}. Ensure it is present in the 'bin' directory of the action.`,
    );
  });
});

describe("run idempotency", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env[ENV_FLY_ACTION_CONFIGURED];
    (fs.existsSync as Mock).mockReturnValue(true);
    (path.resolve as Mock).mockReturnValue("/fake/bin");
  });

  afterEach(() => {
    delete process.env[ENV_FLY_ACTION_CONFIGURED];
  });

  it("skips execution when FLY_ACTION_CONFIGURED is already set", async () => {
    process.env[ENV_FLY_ACTION_CONFIGURED] = "true";

    await run();

    expect(core.info).toHaveBeenCalledWith(
      "Fly action has already been configured in this job, skipping duplicate run.",
    );
    expect(authenticateOidc).not.toHaveBeenCalled();
    expect(exec.exec).not.toHaveBeenCalled();
    expect(core.saveState).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("exports FLY_ACTION_CONFIGURED after successful run", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "url" ? "https://test.com" : "",
    );
    (authenticateOidc as Mock).mockResolvedValue({
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
    });
    vi.mocked(exec.exec).mockResolvedValue(0);

    await run();

    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_ACTION_CONFIGURED,
      "true",
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("does not export FLY_ACTION_CONFIGURED when setup fails", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "url" ? "https://test.com" : "",
    );
    (authenticateOidc as Mock).mockResolvedValue({
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
    });
    vi.mocked(exec.exec).mockResolvedValue(1);

    await run();

    expect(core.exportVariable).not.toHaveBeenCalledWith(
      ENV_FLY_ACTION_CONFIGURED,
      "true",
    );
    expect(core.setFailed).toHaveBeenCalled();
  });
});

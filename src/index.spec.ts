// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";

vi.mock("@actions/core");
vi.mock("@actions/exec");
vi.mock("./oidc", () => ({
  authenticateOidc: vi.fn(),
}));
vi.mock("./fly-cli", () => ({
  downloadFlyCLI: vi.fn(),
  getBinaryName: vi.fn(() => "fly"),
}));

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { resolveOidcUrl, run } from "./index";
import { authenticateOidc } from "./oidc";
import { downloadFlyCLI } from "./fly-cli";
import {
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  ENV_FLY_ACTION_CONFIGURED,
  ENV_FLY_REGISTRY_SUBDOMAIN,
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
  ENV_FLY_IGNORE_PACKAGE_MANAGERS,
  ENV_FLY_URL,
  DEFAULT_FLY_URL,
  CLI_CMD_SETUP,
} from "./constants";

const MOCK_TOKEN = `test-${"access"}-tok`;

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
    (downloadFlyCLI as Mock).mockResolvedValue("/cached/fly");
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

  it("exports FLY_URL and FLY_ACCESS_TOKEN to GITHUB_ENV on success", async () => {
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
      ENV_FLY_URL_RUNTIME,
      "https://resolved-tenant.jfrog.io",
    );
    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_ACCESS_TOKEN_RUNTIME,
      MOCK_TOKEN,
    );
  });

  it("downloads the fly CLI binary", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "url" ? "https://url" : "",
    );
    (authenticateOidc as Mock).mockResolvedValue({
      accessToken: MOCK_TOKEN,
      flyTenantUrl: "https://resolved-tenant.jfrog.io",
    });
    vi.mocked(exec.exec).mockResolvedValue(0);

    await run();

    expect(downloadFlyCLI).toHaveBeenCalled();
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
        expect(env?.[ENV_FLY_IGNORE_PACKAGE_MANAGERS]).toBe("docker");
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
    expect(core.setFailed).toHaveBeenCalledWith("failString");
  });

  it("calls fly setup with correct binary path", async () => {
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
      expect.stringMatching(/[/\\]cached[/\\]fly[/\\]fly$/),
      [CLI_CMD_SETUP],
      expect.objectContaining({
        env: expect.objectContaining({
          [ENV_FLY_URL_RUNTIME]: "https://resolved-tenant.jfrog.io",
          [ENV_FLY_ACCESS_TOKEN_RUNTIME]: MOCK_TOKEN,
        }),
      }),
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});

describe("run error branches", () => {
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
    (downloadFlyCLI as Mock).mockResolvedValue("/cached/fly");
    vi.mocked(exec.exec).mockRejectedValue(new Error("exec error"));

    await run();
    expect(core.setFailed).toHaveBeenCalledWith("exec error");
  });

  it("calls setFailed when binary download fails", async () => {
    (downloadFlyCLI as Mock).mockRejectedValue(
      new Error("Download failed: 404"),
    );

    await run();
    expect(core.setFailed).toHaveBeenCalledWith("Download failed: 404");
  });
});

describe("run idempotency", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env[ENV_FLY_ACTION_CONFIGURED];
    (downloadFlyCLI as Mock).mockResolvedValue("/cached/fly");
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

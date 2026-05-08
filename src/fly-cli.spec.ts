// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";

vi.mock("@actions/core");
vi.mock("@actions/exec");
vi.mock("@actions/tool-cache");
vi.mock("@actions/http-client", () => {
  return {
    HttpClient: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({
        message: { statusCode: 200, headers: {} },
        readBody: vi.fn().mockResolvedValue(""),
      }),
      dispose: vi.fn(),
    })),
  };
});
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, chmodSync: vi.fn(), readFileSync: vi.fn() };
});

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as httpm from "@actions/http-client";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import {
  resolvePlatformArch,
  buildDownloadUrl,
  getBinaryName,
  resolveVersion,
  resolveLatestRedirect,
  downloadFlyCLI,
  execFlyCLI,
  getAuthEnv,
  parseMultilineInput,
} from "./fly-cli";
import {
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
  UNIX_EXECUTABLE_MODE,
} from "./constants";

describe("resolvePlatformArch", () => {
  it("maps darwin/arm64 correctly", () => {
    const origPlatform = process.platform;
    const origArch = process.arch;
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "arch", { value: "arm64" });

    const result = resolvePlatformArch();
    expect(result).toEqual({ os: "darwin", arch: "arm64" });

    Object.defineProperty(process, "platform", { value: origPlatform });
    Object.defineProperty(process, "arch", { value: origArch });
  });

  it("maps linux/x64 to linux/amd64", () => {
    const origPlatform = process.platform;
    const origArch = process.arch;
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "arch", { value: "x64" });

    const result = resolvePlatformArch();
    expect(result).toEqual({ os: "linux", arch: "amd64" });

    Object.defineProperty(process, "platform", { value: origPlatform });
    Object.defineProperty(process, "arch", { value: origArch });
  });

  it("maps win32/x64 to windows/amd64", () => {
    const origPlatform = process.platform;
    const origArch = process.arch;
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "x64" });

    const result = resolvePlatformArch();
    expect(result).toEqual({ os: "windows", arch: "amd64" });

    Object.defineProperty(process, "platform", { value: origPlatform });
    Object.defineProperty(process, "arch", { value: origArch });
  });

  it("throws for unsupported platform", () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "freebsd" });

    expect(() => resolvePlatformArch()).toThrow(
      "Unsupported platform: freebsd",
    );

    Object.defineProperty(process, "platform", { value: origPlatform });
  });

  it("throws for unsupported architecture", () => {
    const origArch = process.arch;
    Object.defineProperty(process, "arch", { value: "ia32" });

    expect(() => resolvePlatformArch()).toThrow(
      "Unsupported architecture: ia32",
    );

    Object.defineProperty(process, "arch", { value: origArch });
  });
});

describe("buildDownloadUrl", () => {
  it("builds URL for darwin-arm64", () => {
    const url = buildDownloadUrl("darwin", "arm64");
    expect(url).toBe(
      "https://flyjfrog.jfrog.io/public/generic/fly-client/[LATEST]/fly-darwin-arm64",
    );
  });

  it("builds URL for windows-amd64 with .exe", () => {
    const url = buildDownloadUrl("windows", "amd64");
    expect(url).toBe(
      "https://flyjfrog.jfrog.io/public/generic/fly-client/[LATEST]/fly-windows-amd64.exe",
    );
  });

  it("builds URL for linux-amd64", () => {
    const url = buildDownloadUrl("linux", "amd64");
    expect(url).toBe(
      "https://flyjfrog.jfrog.io/public/generic/fly-client/[LATEST]/fly-linux-amd64",
    );
  });
});

describe("getBinaryName", () => {
  it("returns fly on non-windows", () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });

    expect(getBinaryName()).toBe("fly");

    Object.defineProperty(process, "platform", { value: origPlatform });
  });

  it("returns fly.exe on windows", () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    expect(getBinaryName()).toBe("fly.exe");

    Object.defineProperty(process, "platform", { value: origPlatform });
  });
});

describe("resolveVersion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("extracts semver from JSON version command output", async () => {
    const jsonOutput = JSON.stringify({
      command: "version",
      results: [{ name: "fly", status: "success", message: "1.2.3" }],
    });
    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(jsonOutput));
      return 0;
    });

    const version = await resolveVersion("/tmp/fly");
    expect(version).toBe("1.2.3");
  });

  it("extracts semver from formatted version message", async () => {
    const jsonOutput = JSON.stringify({
      command: "version",
      results: [
        { name: "fly", status: "success", message: "Fly CLI\nVersion: 2.5.0" },
      ],
    });
    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(jsonOutput));
      return 0;
    });

    const version = await resolveVersion("/tmp/fly");
    expect(version).toBe("2.5.0");
  });

  it("falls back to raw stdout when JSON parsing fails", async () => {
    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from("fly version 3.0.1\n"));
      return 0;
    });

    const version = await resolveVersion("/tmp/fly");
    expect(version).toBe("3.0.1");
  });

  it("returns fallback when no version can be extracted", async () => {
    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(""));
      return 0;
    });

    const version = await resolveVersion("/tmp/fly");
    expect(version).toBe("unknown");
  });

  it("returns unknown when exec throws (e.g. binary not found)", async () => {
    vi.mocked(exec.exec).mockRejectedValue(new Error("ENOENT: no such file"));

    const version = await resolveVersion("/tmp/nonexistent");
    expect(version).toBe("unknown");
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to run fly version"),
    );
  });
});

describe("resolveLatestRedirect", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolves an absolute redirect Location", async () => {
    const get = vi.fn().mockResolvedValue({
      message: {
        statusCode: 302,
        headers: {
          location: "https://other.host.example/public/fly-client/1.2.3/fly",
        },
      },
      readBody: vi.fn().mockResolvedValue(""),
    });
    (httpm.HttpClient as unknown as Mock).mockImplementation(() => ({
      get,
      dispose: vi.fn(),
    }));

    const resolved = await resolveLatestRedirect(
      "https://flyjfrog.jfrog.io/public/generic/fly-client/[LATEST]/fly",
    );
    expect(resolved).toBe(
      "https://other.host.example/public/fly-client/1.2.3/fly",
    );
  });

  it("resolves a relative redirect Location against the request URL", async () => {
    const get = vi.fn().mockResolvedValue({
      message: {
        statusCode: 302,
        headers: {
          location: "/public/generic/fly-client/1.4.7/fly-linux-arm64",
        },
      },
      readBody: vi.fn().mockResolvedValue(""),
    });
    (httpm.HttpClient as unknown as Mock).mockImplementation(() => ({
      get,
      dispose: vi.fn(),
    }));

    const resolved = await resolveLatestRedirect(
      "https://flyjfrog.jfrog.io/public/generic/fly-client/[LATEST]/fly-linux-arm64",
    );
    expect(resolved).toBe(
      "https://flyjfrog.jfrog.io/public/generic/fly-client/1.4.7/fly-linux-arm64",
    );
  });

  it("returns the input URL when the server responds 200", async () => {
    const get = vi.fn().mockResolvedValue({
      message: { statusCode: 200, headers: {} },
      readBody: vi.fn().mockResolvedValue(""),
    });
    (httpm.HttpClient as unknown as Mock).mockImplementation(() => ({
      get,
      dispose: vi.fn(),
    }));

    const url =
      "https://flyjfrog.jfrog.io/public/generic/fly-client/1.4.7/fly-linux-arm64";
    const resolved = await resolveLatestRedirect(url);
    expect(resolved).toBe(url);
  });

  it("throws when redirect has no Location header", async () => {
    const get = vi.fn().mockResolvedValue({
      message: { statusCode: 302, headers: {} },
      readBody: vi.fn().mockResolvedValue(""),
    });
    (httpm.HttpClient as unknown as Mock).mockImplementation(() => ({
      get,
      dispose: vi.fn(),
    }));

    await expect(
      resolveLatestRedirect(
        "https://flyjfrog.jfrog.io/public/generic/fly-client/[LATEST]/fly",
      ),
    ).rejects.toThrow(/without a Location header/);
  });
});

describe("downloadFlyCLI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (tc.find as Mock).mockReturnValue("");
    // Default: server treats the URL as already-resolved (200)
    (httpm.HttpClient as unknown as Mock).mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({
        message: { statusCode: 200, headers: {} },
        readBody: vi.fn().mockResolvedValue(""),
      }),
      dispose: vi.fn(),
    }));
    // Checksum sidecar not available by default — logs debug and proceeds
    (tc.downloadTool as Mock).mockImplementation(async (url: string) => {
      if (url.endsWith(".sha256")) throw new Error("404 Not Found");
      return "/tmp/fly-download";
    });
    // Mock readFileSync for checksum verification (binary content)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("binary-content"));
  });

  it("downloads, caches, and adds to PATH", async () => {
    const jsonOutput = JSON.stringify({
      command: "version",
      results: [{ name: "fly", status: "success", message: "1.2.3" }],
    });
    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(jsonOutput));
      return 0;
    });
    (tc.cacheFile as Mock).mockResolvedValue("/cached/fly/1.2.3");

    const result = await downloadFlyCLI();

    expect(tc.downloadTool).toHaveBeenCalled();
    expect(fs.chmodSync).toHaveBeenCalledWith(
      "/tmp/fly-download",
      UNIX_EXECUTABLE_MODE,
    );
    expect(tc.cacheFile).toHaveBeenCalledWith(
      "/tmp/fly-download",
      expect.any(String),
      "fly",
      "1.2.3",
    );
    expect(core.addPath).toHaveBeenCalledWith("/cached/fly/1.2.3");
    expect(result).toBe("/cached/fly/1.2.3");
  });

  it("reuses existing tool-cache when version matches", async () => {
    const jsonOutput = JSON.stringify({
      command: "version",
      results: [{ name: "fly", status: "success", message: "1.2.3" }],
    });
    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(jsonOutput));
      return 0;
    });
    (tc.find as Mock).mockReturnValue("/cached/fly/1.2.3");

    const result = await downloadFlyCLI();

    expect(tc.downloadTool).toHaveBeenCalled();
    expect(tc.cacheFile).not.toHaveBeenCalled();
    expect(core.addPath).toHaveBeenCalledWith("/cached/fly/1.2.3");
    expect(result).toBe("/cached/fly/1.2.3");
  });

  it("uses content hash when version detection fails", async () => {
    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(""));
      return 0;
    });
    (tc.cacheFile as Mock).mockResolvedValue("/cached/fly/0.0.0-hash");

    const result = await downloadFlyCLI();

    expect(tc.cacheFile).toHaveBeenCalledWith(
      "/tmp/fly-download",
      expect.any(String),
      "fly",
      expect.stringMatching(/^0\.0\.0-[a-f0-9]{12}$/),
    );
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("content hash as cache key"),
    );
    expect(result).toBe("/cached/fly/0.0.0-hash");
  });
});

describe("execFlyCLI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("parses JSON stdout into FlyClientResponse", async () => {
    const jsonResponse = JSON.stringify({
      command: "upload",
      results: [{ name: "file.zip", status: "success" }],
    });

    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(jsonResponse));
      return 0;
    });

    const response = await execFlyCLI(["upload", "--name", "test"]);
    expect(response.command).toBe("upload");
    expect(response.results).toHaveLength(1);
    expect(response.results[0].status).toBe("success");
  });

  it("throws when stdout is not valid JSON", async () => {
    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from("not json"));
      return 1;
    });

    await expect(execFlyCLI(["upload"])).rejects.toThrow(
      "Failed to parse Fly CLI JSON output",
    );
  });

  it("surfaces stderr first when a failed CLI command does not return JSON", async () => {
    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stderr?.(
        Buffer.from(
          '2026/04/26 08:21:49 Fly Client Error:\noutput directory ".ci-artifacts/boost" not found',
        ),
      );
      return 1;
    });

    await expect(execFlyCLI(["download"])).rejects.toThrow(
      /^Fly CLI failed with exit code 1:\n2026\/04\/26 08:21:49 Fly Client Error:\noutput directory ".ci-artifacts\/boost" not found/,
    );
  });

  it("logs stderr as info", async () => {
    const jsonResponse = JSON.stringify({
      command: "upload",
      results: [],
    });

    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(jsonResponse));
      options?.listeners?.stderr?.(Buffer.from("some debug log\n"));
      return 0;
    });

    await execFlyCLI(["upload"]);
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining("some debug log"),
    );
  });

  it("warns on non-zero exit code with valid JSON", async () => {
    const jsonResponse = JSON.stringify({
      command: "upload",
      results: [{ name: "file.zip", status: "error", message: "auth failed" }],
    });

    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(jsonResponse));
      return 1;
    });

    const response = await execFlyCLI(["upload"]);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("exited with code 1"),
    );
    expect(response.results[0].status).toBe("error");
  });

  it("passes env vars to exec when provided", async () => {
    const jsonResponse = JSON.stringify({
      command: "upload",
      results: [],
    });

    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(jsonResponse));
      expect(options?.env?.FLY_URL).toBe("https://test.jfrog.io");
      expect(options?.env?.FLY_ACCESS_TOKEN).toBe("secret");
      return 0;
    });

    await execFlyCLI(["upload"], {
      FLY_URL: "https://test.jfrog.io",
      FLY_ACCESS_TOKEN: "secret",
    });
  });
});

describe("getAuthEnv", () => {
  afterEach(() => {
    delete process.env[ENV_FLY_URL_RUNTIME];
    delete process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME];
  });

  it("returns url and token from environment", () => {
    process.env[ENV_FLY_URL_RUNTIME] = "https://tenant.jfrog.io";
    process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME] = "test-token";

    const { url, token } = getAuthEnv();
    expect(url).toBe("https://tenant.jfrog.io");
    expect(token).toBe("test-token");
  });

  it("throws when FLY_URL is missing", () => {
    delete process.env[ENV_FLY_URL_RUNTIME];
    process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME] = "test-token";

    expect(() => getAuthEnv()).toThrow(
      "FLY_URL environment variable is not set",
    );
  });

  it("throws when FLY_ACCESS_TOKEN is missing", () => {
    process.env[ENV_FLY_URL_RUNTIME] = "https://tenant.jfrog.io";
    delete process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME];

    expect(() => getAuthEnv()).toThrow(
      "FLY_ACCESS_TOKEN environment variable is not set",
    );
  });
});

describe("parseMultilineInput", () => {
  it("splits by newlines and trims whitespace", () => {
    const result = parseMultilineInput(
      "file1.zip\n  file2.tar.gz  \nfile3.bin",
    );
    expect(result).toEqual(["file1.zip", "file2.tar.gz", "file3.bin"]);
  });

  it("filters out empty lines", () => {
    const result = parseMultilineInput("file1.zip\n\n\nfile2.zip\n");
    expect(result).toEqual(["file1.zip", "file2.zip"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseMultilineInput("")).toEqual([]);
    expect(parseMultilineInput("  \n  \n  ")).toEqual([]);
  });

  it("handles single-line input", () => {
    expect(parseMultilineInput("file.zip")).toEqual(["file.zip"]);
  });
});

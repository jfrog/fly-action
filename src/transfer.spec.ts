// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

vi.mock("@actions/core");
vi.mock("./fly-cli", () => ({
  execFlyCLI: vi.fn(),
  getAuthEnv: vi.fn(),
  parseMultilineInput: vi.fn(),
}));

import * as core from "@actions/core";
import { execFlyCLI, getAuthEnv, parseMultilineInput } from "./fly-cli";
import {
  runTransfer,
  appendTransferResults,
  resolveVersion,
  runPublicLatestDownload,
  isLatestToken,
} from "./transfer";
import { ENV_FLY_TRANSFER_RESULTS, LATEST_VERSION } from "./constants";

// Hand-rolled fetch-Response stub (Node 24 has Response globally, but we
// don't want to depend on the real constructor in unit tests).
function fakeResponse(
  body: Uint8Array | null,
  init: { status: number; statusText?: string; finalUrl?: string },
): Response {
  const buf = body ? body.slice().buffer : new ArrayBuffer(0);
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    statusText: init.statusText ?? "",
    url: init.finalUrl ?? "",
    arrayBuffer: async () => buf,
  } as unknown as Response;
}

const mockFetch = vi.fn();
const originalFetch = global.fetch;
beforeAll(() => {
  (global as { fetch: typeof fetch }).fetch =
    mockFetch as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

describe("runTransfer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (getAuthEnv as Mock).mockReturnValue({
      url: "https://tenant.jfrog.io",
      token: "test-token",
    });
  });

  const uploadConfig = {
    type: "upload" as const,
    command: "upload",
    extraArgs: [] as string[],
    noFilesMessage: "No files specified.",
  };

  const downloadConfig = {
    type: "download" as const,
    command: "download",
    extraArgs: ["--output-dir", "./release"],
    outputDir: "./release",
    noFilesMessage: "No files specified.",
  };

  it("builds correct CLI args for upload", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "1.0.0",
        files: "dist/*.zip\ndist/*.tar.gz",
        exclude: "*.log",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["dist/*.zip", "dist/*.tar.gz"])
      .mockReturnValueOnce(["*.log"]);

    (execFlyCLI as Mock).mockResolvedValue({
      command: "upload",
      results: [
        { name: "app.zip", status: "success" },
        { name: "app.tar.gz", status: "success" },
      ],
    });

    await runTransfer(uploadConfig);

    expect(execFlyCLI).toHaveBeenCalledWith(
      [
        "upload",
        "--name",
        "my-app",
        "--version",
        "1.0.0",
        "--exclude",
        "*.log",
        "dist/*.zip",
        "dist/*.tar.gz",
      ],
      {
        FLY_URL: "https://tenant.jfrog.io",
        FLY_ACCESS_TOKEN: "test-token",
      },
    );
    expect(core.setSecret).toHaveBeenCalledWith("test-token");
    expect(core.setOutput).toHaveBeenCalledWith("results", expect.any(String));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("includes extraArgs for concrete-version download (CLI path)", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "1.0.0",
        files: "installer.dmg\nreadme.txt",
        exclude: "*.sig",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["installer.dmg", "readme.txt"])
      .mockReturnValueOnce(["*.sig"]);

    (execFlyCLI as Mock).mockResolvedValue({
      command: "download",
      results: [
        { name: "installer.dmg", status: "success" },
        { name: "readme.txt", status: "success" },
      ],
    });

    await runTransfer(downloadConfig);

    expect(execFlyCLI).toHaveBeenCalledWith(
      [
        "download",
        "--name",
        "my-app",
        "--version",
        "1.0.0",
        "--output-dir",
        "./release",
        "--exclude",
        "*.sig",
        "installer.dmg",
        "readme.txt",
      ],
      {
        FLY_URL: "https://tenant.jfrog.io",
        FLY_ACCESS_TOKEN: "test-token",
      },
    );
  });

  it("calls setFailed with collision message when CLI reports pre-flight basename collision", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "1.0.0",
        files: "dist/**",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["dist/**"])
      .mockReturnValueOnce([]);

    (execFlyCLI as Mock).mockResolvedValue({
      command: "upload",
      results: [
        {
          name: "*",
          status: "error",
          message:
            'basename collision — flat uploads require unique filenames:\n  dist/linux/app and dist/macos/app both upload as "app"',
        },
      ],
    });

    await runTransfer(uploadConfig);

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("basename collision"),
    );
  });

  it("calls setFailed when files have errors", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "1.0.0",
        files: "bad-file.zip",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["bad-file.zip"])
      .mockReturnValueOnce([]);

    (execFlyCLI as Mock).mockResolvedValue({
      command: "upload",
      results: [
        { name: "bad-file.zip", status: "error", message: "file not found" },
      ],
    });

    await runTransfer(uploadConfig);

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Upload failed for 1 file(s)"),
    );
  });

  it("capitalizes type in error message for download", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "1.0.0",
        files: "missing.zip",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["missing.zip"])
      .mockReturnValueOnce([]);

    (execFlyCLI as Mock).mockResolvedValue({
      command: "download",
      results: [
        { name: "missing.zip", status: "error", message: "404 not found" },
      ],
    });

    await runTransfer(downloadConfig);

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Download failed for 1 file(s)"),
    );
  });

  it("calls setFailed when no files specified", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "1.0.0",
        files: "",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    await runTransfer(uploadConfig);

    expect(core.setFailed).toHaveBeenCalledWith("No files specified.");
  });

  it("calls setFailed when auth env is missing", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "1.0.0",
        files: "file.zip",
      };
      return inputs[name] || "";
    });

    (getAuthEnv as Mock).mockImplementation(() => {
      throw new Error("FLY_URL environment variable is not set");
    });

    await runTransfer(uploadConfig);

    expect(core.setFailed).toHaveBeenCalledWith(
      "FLY_URL environment variable is not set",
    );
  });

  it("rejects upload with empty version (defense in depth — YAML required:true is the primary gate)", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "",
        files: "file.zip",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["file.zip"])
      .mockReturnValueOnce([]);

    await runTransfer(uploadConfig);

    expect(execFlyCLI).not.toHaveBeenCalled();
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("version is required for upload"),
    );
  });

  it("calls appendTransferResults with correct args", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "2.0.0",
        files: "file.zip",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["file.zip"])
      .mockReturnValueOnce([]);

    const results = [{ name: "file.zip", status: "success" as const }];
    (execFlyCLI as Mock).mockResolvedValue({
      command: "upload",
      results,
    });

    await runTransfer(uploadConfig);

    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_TRANSFER_RESULTS,
      expect.stringContaining('"type":"upload"'),
    );
  });
});

// runTransfer: [LATEST] download routes via the anonymous public endpoint and
// MUST NOT invoke the fly CLI. Use a fresh tmp dir so the fetch implementation
// in runPublicLatestDownload can actually write files.
describe("runTransfer — [LATEST] download routes via public URL", () => {
  let tmpDir: string;
  let downloadConfig: {
    type: "download";
    command: string;
    extraArgs: string[];
    outputDir: string;
    noFilesMessage: string;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    (getAuthEnv as Mock).mockReturnValue({
      url: "https://tenant.jfrog.io",
      token: "test-token",
    });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fly-action-test-"));
    downloadConfig = {
      type: "download",
      command: "download",
      extraArgs: ["--output-dir", tmpDir],
      outputDir: tmpDir,
      noFilesMessage: "No files specified.",
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fetches the public URL and writes the file to outputDir when version is omitted (defaults to [LATEST])", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "",
        files: "app.dmg",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["app.dmg"])
      .mockReturnValueOnce([]);

    mockFetch.mockResolvedValue(
      fakeResponse(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), {
        status: 200,
        finalUrl: "https://tenant.jfrog.io/public/generic/my-app/2.5.0/app.dmg",
      }),
    );

    await runTransfer(downloadConfig);

    expect(execFlyCLI).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://tenant.jfrog.io/public/generic/my-app/%5BLATEST%5D/app.dmg",
      { redirect: "follow" },
    );

    const written = fs.readFileSync(path.join(tmpDir, "app.dmg"));
    expect(Array.from(written)).toEqual([0xde, 0xad, 0xbe, 0xef]);

    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_TRANSFER_RESULTS,
      expect.stringContaining('"version":"2.5.0"'),
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("treats explicit [LATEST] (and case variants) the same as the default", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "[latest]",
        files: "app.dmg",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["app.dmg"])
      .mockReturnValueOnce([]);

    mockFetch.mockResolvedValue(
      fakeResponse(new Uint8Array([0x68]), {
        status: 200,
        finalUrl: "https://tenant.jfrog.io/public/generic/my-app/3.0.0/app.dmg",
      }),
    );

    await runTransfer(downloadConfig);

    expect(execFlyCLI).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://tenant.jfrog.io/public/generic/my-app/%5BLATEST%5D/app.dmg",
      { redirect: "follow" },
    );
  });

  it("reports a 404 with a 'not publicly distributed' hint and fails the action", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "[LATEST]",
        files: "app.dmg",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["app.dmg"])
      .mockReturnValueOnce([]);

    mockFetch.mockResolvedValue(
      fakeResponse(null, { status: 404, statusText: "Not Found" }),
    );

    await runTransfer(downloadConfig);

    expect(execFlyCLI).not.toHaveBeenCalled();
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("not publicly distributed"),
    );
    // Display version stays as [LATEST] because we never resolved a concrete one.
    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_TRANSFER_RESULTS,
      expect.stringContaining('"version":"[LATEST]"'),
    );
  });

  it("does NOT call fetch when an explicit concrete version is provided on download (CLI path)", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "1.2.3",
        files: "app.dmg",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["app.dmg"])
      .mockReturnValueOnce([]);

    (execFlyCLI as Mock).mockResolvedValue({
      command: "download",
      results: [{ name: "app.dmg", status: "success" }],
    });

    await runTransfer(downloadConfig);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(execFlyCLI).toHaveBeenCalledWith(
      expect.arrayContaining(["--version", "1.2.3"]),
      expect.any(Object),
    );
    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_TRANSFER_RESULTS,
      expect.stringContaining('"version":"1.2.3"'),
    );
  });
});

describe("appendTransferResults", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env[ENV_FLY_TRANSFER_RESULTS];
  });

  it("creates a new JSON line when env var is empty", () => {
    delete process.env[ENV_FLY_TRANSFER_RESULTS];

    appendTransferResults("upload", "my-app", "1.0.0", [
      { name: "file.zip", status: "success" },
    ]);

    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_TRANSFER_RESULTS,
      expect.any(String),
    );

    const exported = (core.exportVariable as Mock).mock.calls[0][1] as string;
    const parsed = JSON.parse(exported);
    expect(parsed).toEqual({
      type: "upload",
      name: "my-app",
      version: "1.0.0",
      results: [{ name: "file.zip", status: "success" }],
    });
  });

  it("appends to existing results with newline separator", () => {
    const existing = JSON.stringify({
      type: "upload",
      name: "first",
      version: "1.0.0",
      results: [{ name: "a.zip", status: "success" }],
    });
    process.env[ENV_FLY_TRANSFER_RESULTS] = existing;

    appendTransferResults("download", "second", "2.0.0", [
      { name: "b.zip", status: "success" },
    ]);

    const exported = (core.exportVariable as Mock).mock.calls[0][1] as string;
    const lines = exported.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(JSON.parse(existing));
    expect(JSON.parse(lines[1])).toEqual({
      type: "download",
      name: "second",
      version: "2.0.0",
      results: [{ name: "b.zip", status: "success" }],
    });
  });

  it("handles multiple results in a single entry", () => {
    appendTransferResults("upload", "pkg", "3.0.0", [
      { name: "a.zip", status: "success" },
      { name: "b.zip", status: "error", message: "checksum mismatch" },
    ]);

    const exported = (core.exportVariable as Mock).mock.calls[0][1] as string;
    const parsed = JSON.parse(exported);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[1].status).toBe("error");
  });
});

describe("isLatestToken", () => {
  it("matches all case variants of [LATEST]", () => {
    expect(isLatestToken("[LATEST]")).toBe(true);
    expect(isLatestToken("[latest]")).toBe(true);
    expect(isLatestToken("[Latest]")).toBe(true);
    expect(isLatestToken("  [LATEST]  ")).toBe(true);
  });

  it("returns false for concrete versions and empty input", () => {
    expect(isLatestToken("1.0.0")).toBe(false);
    expect(isLatestToken("LATEST")).toBe(false);
    expect(isLatestToken("[NOT_LATEST]")).toBe(false);
    expect(isLatestToken("")).toBe(false);
  });
});

describe("runPublicLatestDownload", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fly-action-public-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes each file to outputDir and returns the resolved concrete version", async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse(new Uint8Array([0x01]), {
        status: 200,
        finalUrl: "https://tenant.jfrog.io/public/generic/pkg/1.4.2/a.bin",
      }),
    );
    mockFetch.mockResolvedValueOnce(
      fakeResponse(new Uint8Array([0x02]), {
        status: 200,
        finalUrl: "https://tenant.jfrog.io/public/generic/pkg/1.4.2/b.bin",
      }),
    );

    const result = await runPublicLatestDownload(
      "https://tenant.jfrog.io",
      "pkg",
      ["a.bin", "b.bin"],
      tmpDir,
    );

    expect(result.resolvedVersion).toBe("1.4.2");
    expect(result.results.every((r) => r.status === "success")).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "a.bin"))[0]).toBe(0x01);
    expect(fs.readFileSync(path.join(tmpDir, "b.bin"))[0]).toBe(0x02);
  });

  it("strips trailing slashes from flyUrl before composing the public URL", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(new Uint8Array([0x68]), {
        status: 200,
        finalUrl: "https://tenant.jfrog.io/public/generic/pkg/1.0.0/x",
      }),
    );

    await runPublicLatestDownload(
      "https://tenant.jfrog.io///",
      "pkg",
      ["x"],
      tmpDir,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://tenant.jfrog.io/public/generic/pkg/%5BLATEST%5D/x",
      { redirect: "follow" },
    );
  });

  it("decodes percent-encoded versions in the redirect target URL", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(new Uint8Array([0x68]), {
        status: 200,
        finalUrl:
          "https://tenant.jfrog.io/public/generic/pkg/v1.0.0%2Bbuild.5/file",
      }),
    );

    const result = await runPublicLatestDownload(
      "https://tenant.jfrog.io",
      "pkg",
      ["file"],
      tmpDir,
    );

    expect(result.resolvedVersion).toBe("v1.0.0+build.5");
  });

  it("falls back to literal [LATEST] when the redirect URL does not match the expected shape", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(new Uint8Array([0x68]), {
        status: 200,
        finalUrl: "https://some-cdn.example.com/served-by-cdn",
      }),
    );

    const result = await runPublicLatestDownload(
      "https://tenant.jfrog.io",
      "pkg",
      ["file"],
      tmpDir,
    );

    expect(result.resolvedVersion).toBe(LATEST_VERSION);
  });

  it("surfaces 404 as 'not publicly distributed' and skips the file", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(null, { status: 404, statusText: "Not Found" }),
    );

    const result = await runPublicLatestDownload(
      "https://tenant.jfrog.io",
      "pkg",
      ["file"],
      tmpDir,
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("error");
    expect(result.results[0].message).toContain("not publicly distributed");
    expect(fs.existsSync(path.join(tmpDir, "file"))).toBe(false);
  });

  it("surfaces non-404 HTTP errors with status text", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(null, { status: 500, statusText: "Internal Server Error" }),
    );

    const result = await runPublicLatestDownload(
      "https://tenant.jfrog.io",
      "pkg",
      ["file"],
      tmpDir,
    );

    expect(result.results[0].status).toBe("error");
    expect(result.results[0].message).toContain("500");
    expect(result.results[0].message).toContain("Internal Server Error");
  });

  it("surfaces network failures as a per-file error", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await runPublicLatestDownload(
      "https://tenant.jfrog.io",
      "pkg",
      ["file"],
      tmpDir,
    );

    expect(result.results[0].status).toBe("error");
    expect(result.results[0].message).toContain("ECONNREFUSED");
  });

  it("encodes special characters in package name and filename", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(new Uint8Array([0x68]), {
        status: 200,
        finalUrl:
          "https://tenant.jfrog.io/public/generic/com.example.app/1.0.0/my%20file.txt",
      }),
    );

    await runPublicLatestDownload(
      "https://tenant.jfrog.io",
      "com.example.app",
      ["my file.txt"],
      tmpDir,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://tenant.jfrog.io/public/generic/com.example.app/%5BLATEST%5D/my%20file.txt",
      { redirect: "follow" },
    );
  });
});

describe("resolveVersion (issue #54 item 2)", () => {
  it("returns the trimmed version when one is provided (download)", () => {
    expect(resolveVersion("download", "1.0.0")).toBe("1.0.0");
    expect(resolveVersion("download", "  v2.3.1  ")).toBe("v2.3.1");
  });

  it("returns the trimmed version when one is provided (upload)", () => {
    expect(resolveVersion("upload", "1.0.0")).toBe("1.0.0");
  });

  it("defaults to [LATEST] when version is empty on download", () => {
    expect(resolveVersion("download", "")).toBe(LATEST_VERSION);
    expect(resolveVersion("download", "   ")).toBe(LATEST_VERSION);
  });

  it("throws when version is empty on upload (concrete-version requirement)", () => {
    expect(() => resolveVersion("upload", "")).toThrow(
      /version is required for upload/,
    );
    expect(() => resolveVersion("upload", "   ")).toThrow(
      /version is required for upload/,
    );
  });

  it("preserves explicit [LATEST] on download (case-sensitive pass-through; routing handles case)", () => {
    expect(resolveVersion("download", "[LATEST]")).toBe("[LATEST]");
    expect(resolveVersion("download", "[latest]")).toBe("[latest]");
  });
});

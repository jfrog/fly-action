// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";

vi.mock("@actions/core");
vi.mock("./fly-cli", () => ({
  execFlyCLI: vi.fn(),
  getAuthEnv: vi.fn(),
  parseMultilineInput: vi.fn(),
}));

const mockHead = vi.fn();
const mockDispose = vi.fn();
vi.mock("@actions/http-client", () => ({
  HttpClient: vi.fn(() => ({
    head: mockHead,
    dispose: mockDispose,
  })),
}));

import * as core from "@actions/core";
import { HttpClient } from "@actions/http-client";
import { execFlyCLI, getAuthEnv, parseMultilineInput } from "./fly-cli";
import {
  runTransfer,
  appendTransferResults,
  resolveVersion,
  resolveLatestVersionForDisplay,
  isLatestToken,
} from "./transfer";
import { ENV_FLY_TRANSFER_RESULTS, LATEST_VERSION } from "./constants";

// Re-applies the HttpClient constructor mock after vi.resetAllMocks() clears it.
// runTransfer constructs a new HttpClient inside resolveLatestVersionForDisplay,
// so without this, `new HttpClient()` returns undefined and `client.head()` throws.
function rewireHttpClientMock(): void {
  (HttpClient as unknown as Mock).mockImplementation(() => ({
    head: mockHead,
    dispose: mockDispose,
  }));
}

describe("runTransfer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rewireHttpClientMock();
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

  it("includes extraArgs for download", async () => {
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

  it("defaults version to [LATEST] for download when omitted, resolves concrete version for display (issue #54 item 2)", async () => {
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

    (execFlyCLI as Mock).mockResolvedValue({
      command: "download",
      results: [{ name: "app.dmg", status: "success" }],
    });

    mockHead.mockResolvedValue({
      message: {
        statusCode: 302,
        headers: { location: "/fly/api/v1/generic/my-app/2.5.0/app.dmg" },
      },
    });

    await runTransfer(downloadConfig);

    // CLI invocation still uses literal [LATEST] — the server resolves it via 302.
    expect(execFlyCLI).toHaveBeenCalledWith(
      expect.arrayContaining(["--version", "[LATEST]"]),
      expect.any(Object),
    );
    // Job summary records the concrete version, not literal "[LATEST]".
    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_TRANSFER_RESULTS,
      expect.stringContaining('"version":"2.5.0"'),
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("falls back to literal [LATEST] in display when server returns 404 (no version uploaded)", async () => {
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

    (execFlyCLI as Mock).mockResolvedValue({
      command: "download",
      results: [{ name: "app.dmg", status: "success" }],
    });

    mockHead.mockResolvedValue({
      message: { statusCode: 404, headers: {} },
    });

    await runTransfer(downloadConfig);

    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_TRANSFER_RESULTS,
      expect.stringContaining('"version":"[LATEST]"'),
    );
  });

  it("does not call resolver when an explicit concrete version is provided on download", async () => {
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

    expect(mockHead).not.toHaveBeenCalled();
    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_TRANSFER_RESULTS,
      expect.stringContaining('"version":"1.2.3"'),
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

  it("passes [LATEST] through unchanged when explicitly set on download", async () => {
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

    (execFlyCLI as Mock).mockResolvedValue({
      command: "download",
      results: [{ name: "app.dmg", status: "success" }],
    });

    await runTransfer(downloadConfig);

    expect(execFlyCLI).toHaveBeenCalledWith(
      expect.arrayContaining(["--version", "[LATEST]"]),
      expect.any(Object),
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

describe("resolveLatestVersionForDisplay (issue #54 item 2)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rewireHttpClientMock();
  });

  it("extracts the concrete version from a 302 Location header", async () => {
    mockHead.mockResolvedValue({
      message: {
        statusCode: 302,
        headers: { location: "/fly/api/v1/generic/my-app/1.4.2/installer.dmg" },
      },
    });

    const result = await resolveLatestVersionForDisplay(
      "https://tenant.jfrog.io",
      "tok",
      "my-app",
      "installer.dmg",
    );

    expect(result).toBe("1.4.2");
    expect(mockHead).toHaveBeenCalledWith(
      "https://tenant.jfrog.io/fly/api/v1/generic/my-app/[LATEST]/installer.dmg",
      { Authorization: "Bearer tok" },
    );
    expect(mockDispose).toHaveBeenCalled();
  });

  it("decodes percent-encoded versions in the Location header", async () => {
    mockHead.mockResolvedValue({
      message: {
        statusCode: 302,
        headers: {
          location: "/fly/api/v1/generic/my-app/v1.0.0%2Bbuild.5/file",
        },
      },
    });

    const result = await resolveLatestVersionForDisplay(
      "https://tenant.jfrog.io",
      "tok",
      "my-app",
      "file",
    );

    expect(result).toBe("v1.0.0+build.5");
  });

  it("strips a trailing slash from flyUrl before composing the resolve URL", async () => {
    mockHead.mockResolvedValue({
      message: {
        statusCode: 302,
        headers: { location: "/fly/api/v1/generic/my-app/1.0.0/file" },
      },
    });

    await resolveLatestVersionForDisplay(
      "https://tenant.jfrog.io///",
      "tok",
      "my-app",
      "file",
    );

    expect(mockHead).toHaveBeenCalledWith(
      "https://tenant.jfrog.io/fly/api/v1/generic/my-app/[LATEST]/file",
      expect.any(Object),
    );
  });

  it("falls back to literal [LATEST] on non-302 status (e.g. 404 empty package)", async () => {
    mockHead.mockResolvedValue({
      message: { statusCode: 404, headers: {} },
    });

    const result = await resolveLatestVersionForDisplay(
      "https://tenant.jfrog.io",
      "tok",
      "missing",
      "file",
    );

    expect(result).toBe(LATEST_VERSION);
    expect(mockDispose).toHaveBeenCalled();
  });

  it("falls back when Location header is missing on a 302", async () => {
    mockHead.mockResolvedValue({
      message: { statusCode: 302, headers: {} },
    });

    const result = await resolveLatestVersionForDisplay(
      "https://tenant.jfrog.io",
      "tok",
      "my-app",
      "file",
    );

    expect(result).toBe(LATEST_VERSION);
  });

  it("falls back when Location header points to an unexpected path shape", async () => {
    mockHead.mockResolvedValue({
      message: {
        statusCode: 302,
        headers: { location: "/some/other/path" },
      },
    });

    const result = await resolveLatestVersionForDisplay(
      "https://tenant.jfrog.io",
      "tok",
      "my-app",
      "file",
    );

    expect(result).toBe(LATEST_VERSION);
  });

  it("falls back and emits a warning when the HTTP request throws", async () => {
    mockHead.mockRejectedValue(new Error("network down"));

    const result = await resolveLatestVersionForDisplay(
      "https://tenant.jfrog.io",
      "tok",
      "my-app",
      "file",
    );

    expect(result).toBe(LATEST_VERSION);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("network down"),
    );
    expect(mockDispose).toHaveBeenCalled();
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

  it("preserves explicit [LATEST] on download (case-sensitive pass-through; server handles case)", () => {
    expect(resolveVersion("download", "[LATEST]")).toBe("[LATEST]");
    expect(resolveVersion("download", "[latest]")).toBe("[latest]");
  });
});

// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";

vi.mock("@actions/core");
vi.mock("./fly-cli", () => ({
  execFlyCLI: vi.fn(),
  getAuthEnv: vi.fn(),
  parseMultilineInput: vi.fn(),
}));

import * as core from "@actions/core";
import { execFlyCLI, getAuthEnv, parseMultilineInput } from "./fly-cli";
import { runTransfer, appendTransferResults } from "./transfer";
import { ENV_FLY_TRANSFER_RESULTS } from "./constants";

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

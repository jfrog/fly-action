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
import { runDownload } from "./download";

describe("runDownload", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (getAuthEnv as Mock).mockReturnValue({
      url: "https://tenant.jfrog.io",
      token: "test-token",
    });
  });

  it("builds correct CLI args from inputs", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "1.0.0",
        files: "installer.dmg\nreadme.txt",
        "output-dir": "./release",
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

    await runDownload();

    expect(execFlyCLI).toHaveBeenCalledWith([
      "download",
      "--name", "my-app",
      "--version", "1.0.0",
      "--output-dir", "./release",
      "--url", "https://tenant.jfrog.io",
      "--access-token", "test-token",
      "--exclude", "*.sig",
      "installer.dmg",
      "readme.txt",
    ]);
    expect(core.setOutput).toHaveBeenCalledWith(
      "results",
      expect.any(String),
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("uses default output-dir when not specified", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        name: "my-app",
        version: "1.0.0",
        files: "file.zip",
        "output-dir": "",
        exclude: "",
      };
      return inputs[name] || "";
    });

    (parseMultilineInput as Mock)
      .mockReturnValueOnce(["file.zip"])
      .mockReturnValueOnce([]);

    (execFlyCLI as Mock).mockResolvedValue({
      command: "download",
      results: [{ name: "file.zip", status: "success" }],
    });

    await runDownload();

    expect(execFlyCLI).toHaveBeenCalledWith(
      expect.arrayContaining(["--output-dir", "."]),
    );
  });

  it("calls setFailed when files have errors", async () => {
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

    await runDownload();

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

    await runDownload();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("No files specified"),
    );
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
      throw new Error("FLY_ACCESS_TOKEN environment variable is not set");
    });

    await runDownload();

    expect(core.setFailed).toHaveBeenCalledWith(
      "FLY_ACCESS_TOKEN environment variable is not set",
    );
  });
});

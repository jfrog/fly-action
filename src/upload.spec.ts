// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";

vi.mock("@actions/core");
vi.mock("./fly-cli", () => ({
  execFlyCLI: vi.fn(),
  getAuthEnv: vi.fn(),
  parseMultilineInput: vi.fn(),
  appendTransferResults: vi.fn(),
}));

import * as core from "@actions/core";
import {
  execFlyCLI,
  getAuthEnv,
  parseMultilineInput,
  appendTransferResults,
} from "./fly-cli";
import { runUpload } from "./upload";

describe("runUpload", () => {
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

    await runUpload();

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
    expect(appendTransferResults).toHaveBeenCalledWith(
      "upload",
      "my-app",
      "1.0.0",
      [
        { name: "app.zip", status: "success" },
        { name: "app.tar.gz", status: "success" },
      ],
    );
    expect(core.setFailed).not.toHaveBeenCalled();
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

    await runUpload();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Upload failed for 1 file(s)"),
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

    await runUpload();

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
      throw new Error("FLY_URL environment variable is not set");
    });

    await runUpload();

    expect(core.setFailed).toHaveBeenCalledWith(
      "FLY_URL environment variable is not set",
    );
  });
});

// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";

vi.mock("@actions/core");
vi.mock("./transfer", () => ({
  runTransfer: vi.fn(),
}));

import * as core from "@actions/core";
import { runTransfer } from "./transfer";
import { runDownload } from "./download";

describe("runDownload", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls runTransfer with download config", async () => {
    vi.mocked(core.getInput).mockReturnValue("");

    await runDownload();

    expect(runTransfer).toHaveBeenCalledWith({
      type: "download",
      command: "download",
      extraArgs: ["--output-dir", "."],
      outputDir: ".",
      noFilesMessage: expect.stringContaining("remote filename"),
    });
  });

  it("passes custom output-dir from input", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "output-dir") return "./release";
      return "";
    });

    await runDownload();

    const config = (runTransfer as Mock).mock.calls[0][0];
    expect(config.extraArgs).toEqual(["--output-dir", "./release"]);
    expect(config.outputDir).toBe("./release");
  });

  it("falls back to default output-dir when input is empty", async () => {
    vi.mocked(core.getInput).mockReturnValue("");

    await runDownload();

    const config = (runTransfer as Mock).mock.calls[0][0];
    expect(config.extraArgs).toEqual(["--output-dir", "."]);
    expect(config.outputDir).toBe(".");
  });
});

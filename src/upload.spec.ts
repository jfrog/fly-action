// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";

vi.mock("@actions/core");
vi.mock("./transfer", () => ({
  runTransfer: vi.fn(),
}));

import * as core from "@actions/core";
import { runTransfer } from "./transfer";
import { runUpload, buildUploadExtraArgs } from "./upload";

describe("runUpload", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls runTransfer with upload config and no extraArgs when if-no-files-found is omitted", async () => {
    vi.mocked(core.getInput).mockReturnValue("");

    await runUpload();

    expect(runTransfer).toHaveBeenCalledWith({
      type: "upload",
      command: "upload",
      extraArgs: [],
      noFilesMessage: expect.stringContaining("file path or glob pattern"),
    });
  });

  it("passes the correct CLI command", async () => {
    vi.mocked(core.getInput).mockReturnValue("");

    await runUpload();

    const config = (runTransfer as Mock).mock.calls[0][0];
    expect(config.command).toBe("upload");
    expect(config.type).toBe("upload");
  });

  it("forwards a valid if-no-files-found value as a CLI flag", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "if-no-files-found" ? "warn" : "",
    );

    await runUpload();

    const config = (runTransfer as Mock).mock.calls[0][0];
    expect(config.extraArgs).toEqual(["--if-no-files-found", "warn"]);
  });

  it("fails the step (setFailed) on an invalid if-no-files-found value and never invokes runTransfer", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) =>
      name === "if-no-files-found" ? "ohno" : "",
    );

    await runUpload();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid value for `if-no-files-found`: "ohno"'),
    );
    expect(runTransfer).not.toHaveBeenCalled();
  });
});

describe("buildUploadExtraArgs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns an empty array when the input is missing or whitespace", () => {
    vi.mocked(core.getInput).mockReturnValue("");
    expect(buildUploadExtraArgs()).toEqual([]);

    vi.mocked(core.getInput).mockReturnValue("   ");
    expect(buildUploadExtraArgs()).toEqual([]);
  });

  it.each(["error", "warn", "ignore"])(
    "passes through allowed value %s as a CLI flag",
    (value) => {
      vi.mocked(core.getInput).mockReturnValue(value);
      expect(buildUploadExtraArgs()).toEqual(["--if-no-files-found", value]);
    },
  );

  it("trims surrounding whitespace before forwarding the flag", () => {
    vi.mocked(core.getInput).mockReturnValue("  warn  ");
    expect(buildUploadExtraArgs()).toEqual(["--if-no-files-found", "warn"]);
  });

  it("rejects unknown values with a descriptive error listing the allowed set", () => {
    vi.mocked(core.getInput).mockReturnValue("WARN");
    expect(() => buildUploadExtraArgs()).toThrow(
      /Invalid value for `if-no-files-found`: "WARN"\. Must be one of: "error", "warn", "ignore"\./,
    );
  });

  it("rejects empty-after-trim sentinel values that aren't on the allowed list", () => {
    vi.mocked(core.getInput).mockReturnValue("none");
    expect(() => buildUploadExtraArgs()).toThrow(
      /Invalid value for `if-no-files-found`: "none"/,
    );
  });
});

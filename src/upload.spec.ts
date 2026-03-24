// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";

vi.mock("@actions/core");
vi.mock("./transfer", () => ({
  runTransfer: vi.fn(),
}));

import { runTransfer } from "./transfer";
import { runUpload } from "./upload";

describe("runUpload", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls runTransfer with upload config", async () => {
    await runUpload();

    expect(runTransfer).toHaveBeenCalledWith({
      type: "upload",
      command: "upload",
      extraArgs: [],
      noFilesMessage: expect.stringContaining("file path or glob pattern"),
    });
  });

  it("passes the correct CLI command", async () => {
    await runUpload();

    const config = (runTransfer as Mock).mock.calls[0][0];
    expect(config.command).toBe("upload");
    expect(config.type).toBe("upload");
  });
});

// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";

vi.mock("@actions/core");
vi.mock("./fly-cli", () => ({
  execFlyCLI: vi.fn(),
  getAuthEnv: vi.fn(),
}));
vi.mock("./transfer", () => ({
  appendTransferResults: vi.fn(),
}));

import * as core from "@actions/core";
import { execFlyCLI, getAuthEnv } from "./fly-cli";
import { appendTransferResults } from "./transfer";
import { runGoPublish } from "./go-publish";

describe("runGoPublish", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (getAuthEnv as Mock).mockReturnValue({
      url: "https://tenant.jfrog.io",
      token: "test-token",
    });
  });

  it("calls fly publish go with default path", async () => {
    vi.mocked(core.getInput).mockReturnValue("");

    (execFlyCLI as Mock).mockResolvedValue({
      command: "publish",
      results: [
        {
          name: "github.com/acme/app@v1.0.0",
          status: "success",
          message: "published 3 artifacts",
        },
      ],
    });

    await runGoPublish();

    expect(execFlyCLI).toHaveBeenCalledWith(["publish", "go", "."], {
      FLY_URL: "https://tenant.jfrog.io",
      FLY_ACCESS_TOKEN: "test-token",
    });
    expect(core.setSecret).toHaveBeenCalledWith("test-token");
    expect(core.setOutput).toHaveBeenCalledWith("results", expect.any(String));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("passes custom path and version", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        path: "./libs/shared",
        version: "v2.0.0",
      };
      return inputs[name] || "";
    });

    (execFlyCLI as Mock).mockResolvedValue({
      command: "publish",
      results: [
        {
          name: "github.com/acme/shared@v2.0.0",
          status: "success",
          message: "published 3 artifacts",
        },
      ],
    });

    await runGoPublish();

    expect(execFlyCLI).toHaveBeenCalledWith(
      ["publish", "go", "./libs/shared", "--version", "v2.0.0"],
      {
        FLY_URL: "https://tenant.jfrog.io",
        FLY_ACCESS_TOKEN: "test-token",
      },
    );
  });

  it("omits --version flag when version is not provided", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = { path: "./mylib" };
      return inputs[name] || "";
    });

    (execFlyCLI as Mock).mockResolvedValue({
      command: "publish",
      results: [
        {
          name: "github.com/acme/mylib@v0.0.0-20260412-abc123",
          status: "success",
          message: "published 3 artifacts",
        },
      ],
    });

    await runGoPublish();

    expect(execFlyCLI).toHaveBeenCalledWith(["publish", "go", "./mylib"], {
      FLY_URL: "https://tenant.jfrog.io",
      FLY_ACCESS_TOKEN: "test-token",
    });
  });

  it("calls setFailed when results contain errors", async () => {
    vi.mocked(core.getInput).mockReturnValue("");

    (execFlyCLI as Mock).mockResolvedValue({
      command: "publish",
      results: [
        {
          name: ".",
          status: "error",
          message: "GOPROXY is not set",
        },
      ],
    });

    await runGoPublish();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("GOPROXY is not set"),
    );
  });

  it("calls setFailed when CLI throws", async () => {
    vi.mocked(core.getInput).mockReturnValue("");
    (execFlyCLI as Mock).mockRejectedValue(new Error("CLI not found"));

    await runGoPublish();

    expect(core.setFailed).toHaveBeenCalledWith("CLI not found");
  });

  it("calls setFailed when auth env is missing", async () => {
    vi.mocked(core.getInput).mockReturnValue("");
    (getAuthEnv as Mock).mockImplementation(() => {
      throw new Error("FLY_URL environment variable is not set");
    });

    await runGoPublish();

    expect(core.setFailed).toHaveBeenCalledWith(
      "FLY_URL environment variable is not set",
    );
  });

  it("appends transfer results for job summary", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        path: "./mylib",
        version: "v1.5.0",
      };
      return inputs[name] || "";
    });

    const results = [
      {
        name: "github.com/acme/mylib@v1.5.0",
        status: "success" as const,
        message: "published 3 artifacts",
      },
    ];

    (execFlyCLI as Mock).mockResolvedValue({
      command: "publish",
      results,
    });

    await runGoPublish();

    expect(appendTransferResults).toHaveBeenCalledWith(
      "upload",
      "./mylib",
      "v1.5.0",
      results,
    );
  });
});

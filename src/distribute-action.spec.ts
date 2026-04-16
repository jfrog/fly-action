// Copyright (c) JFrog Ltd. (2025)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setSecret: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  exportVariable: vi.fn(),
}));

const mockPost = vi.fn();
const mockDispose = vi.fn();

vi.mock("./utils", () => ({
  createHttpClient: () => ({
    post: mockPost,
    dispose: mockDispose,
  }),
  truncate: (s: string) => s,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import * as core from "@actions/core";
import { runDistribute } from "./distribute-action";
import {
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
  ENV_FLY_DISTRIBUTE_RESULTS,
} from "./constants";
import type { DistributeResponse } from "./types";

const MOCK_RESPONSE: DistributeResponse = {
  package_name: "my-app",
  package_version: "1.0.0",
  package_type: "generic",
  public_url: "https://fly.example.com/public/generic/tenant/my-app/1.0.0",
  download_url:
    "https://fly.example.com/public/generic/tenant/my-app/1.0.0/my-app.tar.gz",
  download_count: 0,
};

describe("runDistribute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockReset();
    mockDispose.mockReset();

    process.env[ENV_FLY_URL_RUNTIME] = "https://fly.example.com";
    process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME] = "test-token";
    delete process.env[ENV_FLY_DISTRIBUTE_RESULTS];
  });

  afterEach(() => {
    delete process.env[ENV_FLY_URL_RUNTIME];
    delete process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME];
    delete process.env[ENV_FLY_DISTRIBUTE_RESULTS];
  });

  it("distributes a single artifact and sets output", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "artifacts") return "my-app:1.0.0";
      if (name === "type") return "generic";
      return "";
    });

    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(MOCK_RESPONSE)),
    });

    await runDistribute();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith(
      "results",
      JSON.stringify([MOCK_RESPONSE]),
    );
    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_DISTRIBUTE_RESULTS,
      JSON.stringify([MOCK_RESPONSE]),
    );
    expect(mockDispose).toHaveBeenCalled();
  });

  it("distributes multiple artifacts", async () => {
    const response2: DistributeResponse = {
      ...MOCK_RESPONSE,
      package_name: "my-lib",
      package_version: "2.3.1",
    };

    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "artifacts") return "my-app:1.0.0, my-lib:2.3.1";
      if (name === "type") return "generic";
      return "";
    });

    mockPost
      .mockResolvedValueOnce({
        message: { statusCode: 200 },
        readBody: () => Promise.resolve(JSON.stringify(MOCK_RESPONSE)),
      })
      .mockResolvedValueOnce({
        message: { statusCode: 200 },
        readBody: () => Promise.resolve(JSON.stringify(response2)),
      });

    await runDistribute();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledTimes(2);

    const outputJson = vi.mocked(core.setOutput).mock.calls[0][1] as string;
    const outputResults = JSON.parse(outputJson);
    expect(outputResults).toHaveLength(2);
  });

  it("fails when auth is not configured", async () => {
    delete process.env[ENV_FLY_URL_RUNTIME];

    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "artifacts") return "my-app:1.0.0";
      return "";
    });

    await runDistribute();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("FLY_URL"),
    );
  });

  it("fails on empty artifacts input", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "artifacts") return "";
      return "";
    });

    await runDistribute();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("No artifacts to distribute"),
    );
  });

  it("fails when API returns non-200", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "artifacts") return "my-app:1.0.0";
      if (name === "type") return "generic";
      return "";
    });

    mockPost.mockResolvedValue({
      message: { statusCode: 404 },
      readBody: () => Promise.resolve("not found"),
    });

    await runDistribute();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Failed to distribute"),
    );
  });

  it("defaults package type to generic", async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "artifacts") return "my-app:1.0.0";
      return "";
    });

    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(MOCK_RESPONSE)),
    });

    await runDistribute();

    const body = JSON.parse(mockPost.mock.calls[0][1]);
    expect(body.package_type).toBe("generic");
  });
});

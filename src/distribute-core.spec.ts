// Copyright (c) JFrog Ltd. (2025)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseDistributeInput, distributeArtifacts } from "./distribute-core";
import type { DistributeResponse } from "./types";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

const mockPost = vi.fn();
const mockDispose = vi.fn();

vi.mock("./utils", () => ({
  createHttpClient: () => ({
    post: mockPost,
    dispose: mockDispose,
  }),
  truncate: (s: string) => s,
}));

describe("parseDistributeInput", () => {
  it("parses a single entry", () => {
    const result = parseDistributeInput("my-app:1.0.0", "generic");
    expect(result).toEqual([
      { name: "my-app", version: "1.0.0", type: "generic" },
    ]);
  });

  it("parses multiple comma-separated entries", () => {
    const result = parseDistributeInput(
      "my-app:1.0.0, my-lib:2.3.1",
      "generic",
    );
    expect(result).toEqual([
      { name: "my-app", version: "1.0.0", type: "generic" },
      { name: "my-lib", version: "2.3.1", type: "generic" },
    ]);
  });

  it("trims whitespace from entries", () => {
    const result = parseDistributeInput("  my-app : 1.0.0 ", "generic");
    expect(result).toEqual([
      { name: "my-app", version: "1.0.0", type: "generic" },
    ]);
  });

  it("skips empty entries from trailing commas", () => {
    const result = parseDistributeInput("my-app:1.0.0,", "generic");
    expect(result).toEqual([
      { name: "my-app", version: "1.0.0", type: "generic" },
    ]);
  });

  it("uses the last colon as separator for names with colons", () => {
    const result = parseDistributeInput("org/my-app:1.0.0", "generic");
    expect(result).toEqual([
      { name: "org/my-app", version: "1.0.0", type: "generic" },
    ]);
  });

  it("throws on entry without version", () => {
    expect(() => parseDistributeInput("my-app", "generic")).toThrow(
      'Invalid distribute entry "my-app"',
    );
  });

  it("throws on entry with only a leading colon", () => {
    expect(() => parseDistributeInput(":1.0.0", "generic")).toThrow(
      'Invalid distribute entry ":1.0.0"',
    );
  });

  it("returns empty array for empty input", () => {
    const result = parseDistributeInput("", "generic");
    expect(result).toEqual([]);
  });

  it("respects custom package type", () => {
    const result = parseDistributeInput("my-app:1.0.0", "npm");
    expect(result).toEqual([{ name: "my-app", version: "1.0.0", type: "npm" }]);
  });
});

describe("distributeArtifacts", () => {
  const mockResponse: DistributeResponse = {
    package_name: "my-app",
    package_version: "1.0.0",
    package_type: "generic",
    public_url: "https://fly.example.com/public/generic/tenant/my-app/1.0.0",
    download_url:
      "https://fly.example.com/public/generic/tenant/my-app/1.0.0/my-app.tar.gz",
    download_count: 0,
  };

  beforeEach(() => {
    mockPost.mockReset();
    mockDispose.mockReset();
  });

  it("calls the distribute endpoint and returns the success", async () => {
    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const outcome = await distributeArtifacts(
      "https://fly.example.com",
      "token123",
      [{ name: "my-app", version: "1.0.0", type: "generic" }],
    );

    expect(outcome.successes).toHaveLength(1);
    expect(outcome.failures).toHaveLength(0);
    expect(outcome.successes[0].package_name).toBe("my-app");
    expect(outcome.successes[0].public_url).toContain("my-app");

    expect(mockPost).toHaveBeenCalledWith(
      "https://fly.example.com/fly/api/v1/artifacts/distribute",
      expect.any(String),
      expect.objectContaining({
        Authorization: "Bearer token123",
        "X-JFROG-FLY-TENANT-HOST": "fly.example.com",
      }),
    );
    expect(mockDispose).toHaveBeenCalled();
  });

  it("sends correct JSON body", async () => {
    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    await distributeArtifacts("https://fly.example.com", "token123", [
      { name: "my-app", version: "1.0.0", type: "generic" },
    ]);

    const body = JSON.parse(mockPost.mock.calls[0][1]);
    expect(body).toEqual({
      package_name: "my-app",
      package_version: "1.0.0",
      package_type: "generic",
    });
  });

  it("distributes multiple artifacts sequentially", async () => {
    const response2: DistributeResponse = {
      ...mockResponse,
      package_name: "my-lib",
      package_version: "2.0.0",
    };

    mockPost
      .mockResolvedValueOnce({
        message: { statusCode: 200 },
        readBody: () => Promise.resolve(JSON.stringify(mockResponse)),
      })
      .mockResolvedValueOnce({
        message: { statusCode: 200 },
        readBody: () => Promise.resolve(JSON.stringify(response2)),
      });

    const outcome = await distributeArtifacts(
      "https://fly.example.com",
      "token123",
      [
        { name: "my-app", version: "1.0.0", type: "generic" },
        { name: "my-lib", version: "2.0.0", type: "generic" },
      ],
    );

    expect(outcome.successes).toHaveLength(2);
    expect(outcome.failures).toHaveLength(0);
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it("records a failure on non-200 without throwing", async () => {
    mockPost.mockResolvedValue({
      message: { statusCode: 400 },
      readBody: () => Promise.resolve('{"error": "bad request"}'),
    });

    const outcome = await distributeArtifacts(
      "https://fly.example.com",
      "token123",
      [{ name: "my-app", version: "1.0.0", type: "generic" }],
    );

    expect(outcome.successes).toHaveLength(0);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0].entry.name).toBe("my-app");
    expect(outcome.failures[0].error).toContain("400");
    expect(mockDispose).toHaveBeenCalled();
  });

  it("records a failure on network error without throwing", async () => {
    mockPost.mockRejectedValue(new Error("network error"));

    const outcome = await distributeArtifacts(
      "https://fly.example.com",
      "token123",
      [{ name: "my-app", version: "1.0.0", type: "generic" }],
    );

    expect(outcome.successes).toHaveLength(0);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0].error).toBe("network error");
    expect(mockDispose).toHaveBeenCalled();
  });

  it("preserves earlier successes when a later entry fails", async () => {
    mockPost
      .mockResolvedValueOnce({
        message: { statusCode: 200 },
        readBody: () => Promise.resolve(JSON.stringify(mockResponse)),
      })
      .mockResolvedValueOnce({
        message: { statusCode: 500 },
        readBody: () => Promise.resolve("server error"),
      });

    const outcome = await distributeArtifacts(
      "https://fly.example.com",
      "token123",
      [
        { name: "my-app", version: "1.0.0", type: "generic" },
        { name: "my-lib", version: "2.0.0", type: "generic" },
      ],
    );

    expect(outcome.successes).toHaveLength(1);
    expect(outcome.successes[0].package_name).toBe("my-app");
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0].entry.name).toBe("my-lib");
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it("strips trailing slashes from tenant host", async () => {
    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    await distributeArtifacts("https://fly.example.com/", "token123", [
      { name: "my-app", version: "1.0.0", type: "generic" },
    ]);

    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        "X-JFROG-FLY-TENANT-HOST": "fly.example.com",
      }),
    );
  });
});

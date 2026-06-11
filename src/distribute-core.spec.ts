// Copyright (c) JFrog Ltd. (2025)

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as core from "@actions/core";
import { distributeArtifact } from "./distribute-core";
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

describe("distributeArtifact", () => {
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
    vi.mocked(core.info).mockReset();
  });

  it("calls the distribute endpoint and returns the response", async () => {
    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await distributeArtifact(
      "https://fly.example.com",
      "token123",
      "my-app",
      "1.0.0",
      "generic",
    );

    expect(result.package_name).toBe("my-app");
    expect(result.public_url).toContain("my-app");

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

  it("sends the correct JSON body", async () => {
    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    await distributeArtifact(
      "https://fly.example.com",
      "token123",
      "my-app",
      "1.0.0",
      "generic",
    );

    const body = JSON.parse(mockPost.mock.calls[0][1]);
    expect(body).toEqual({
      package_name: "my-app",
      package_version: "1.0.0",
      package_type: "generic",
    });
  });

  it("throws on non-200 status", async () => {
    mockPost.mockResolvedValue({
      message: { statusCode: 400 },
      readBody: () => Promise.resolve('{"error": "bad request"}'),
    });

    await expect(
      distributeArtifact(
        "https://fly.example.com",
        "token123",
        "my-app",
        "1.0.0",
        "generic",
      ),
    ).rejects.toThrow(/Failed to distribute my-app:1.0.0.*400/);

    expect(mockDispose).toHaveBeenCalled();
  });

  it("propagates network errors and still disposes the client", async () => {
    mockPost.mockRejectedValue(new Error("network error"));

    await expect(
      distributeArtifact(
        "https://fly.example.com",
        "token123",
        "my-app",
        "1.0.0",
        "generic",
      ),
    ).rejects.toThrow("network error");

    expect(mockDispose).toHaveBeenCalled();
  });

  it("strips trailing slashes from the tenant host", async () => {
    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    await distributeArtifact(
      "https://fly.example.com/",
      "token123",
      "my-app",
      "1.0.0",
      "generic",
    );

    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        "X-JFROG-FLY-TENANT-HOST": "fly.example.com",
      }),
    );
  });

  it("logs the generic download link and never the 404-ing public URL", async () => {
    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    await distributeArtifact(
      "https://fly.example.com",
      "token123",
      "my-app",
      "1.0.0",
      "generic",
    );

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining(`Download:   ${mockResponse.download_url}`),
    );
    expect(core.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Public URL"),
    );
  });

  it("logs only the docker pull command, never the public/manifest URLs", async () => {
    const dockerResponse: DistributeResponse = {
      package_name: "my-image",
      package_version: "1.0.0",
      package_type: "docker",
      public_url: "https://fly.example.com/v2/docker-public/my-image",
      download_url:
        "https://fly.example.com/v2/docker-public/my-image/manifests/1.0.0",
      download_count: 0,
    };
    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(dockerResponse)),
    });

    await distributeArtifact(
      "https://fly.example.com",
      "token123",
      "my-image",
      "1.0.0",
      "docker",
    );

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining(
        "Pull:       docker pull fly.example.com/docker-public/my-image:1.0.0",
      ),
    );
    expect(core.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Public URL"),
    );
    expect(core.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Download:"),
    );
  });

  it("honors a non-generic package type", async () => {
    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    await distributeArtifact(
      "https://fly.example.com",
      "token123",
      "my-app",
      "1.0.0",
      "npm",
    );

    const body = JSON.parse(mockPost.mock.calls[0][1]);
    expect(body.package_type).toBe("npm");
  });
});

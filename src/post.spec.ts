// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { HttpClient, HttpClientResponse } from "@actions/http-client";
import { IncomingHttpHeaders } from "http";
import { STATE_FLY_URL, STATE_FLY_ACCESS_TOKEN } from "./constants";
import { runPost, runPostScriptLogic } from "./post";

// Mock @actions/core
jest.mock("@actions/core");
jest.mock("@actions/http-client");

const mockCore = core as jest.Mocked<typeof core>;
const mockHttpClientPost = jest.fn();

interface MockSummary {
  addHeading: jest.Mock;
  addRaw: jest.Mock;
  addBreak: jest.Mock;
  addQuote: jest.Mock;
  addTable: jest.Mock;
  addLink: jest.Mock;
  write: jest.Mock;
}

let mockSummary: MockSummary;

// Standard ci/end response with artifacts
const END_CI_RESPONSE_WITH_ARTIFACTS = JSON.stringify({
  artifacts: [
    {
      name: "my-lib",
      type: "npm",
      repo_key: "npm-local",
      path: "npm-local/my-lib/-/my-lib-1.0.0.tgz",
    },
    { name: "my-app", type: "docker", repo_key: "docker-local" },
  ],
});

const END_CI_RESPONSE_EMPTY = JSON.stringify({ artifacts: [] });

describe("runPost", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock the summary object with chainable methods
    mockSummary = {
      addHeading: jest.fn().mockReturnThis(),
      addRaw: jest.fn().mockReturnThis(),
      addBreak: jest.fn().mockReturnThis(),
      addQuote: jest.fn().mockReturnThis(),
      addTable: jest.fn().mockReturnThis(),
      addLink: jest.fn().mockReturnThis(),
      write: jest.fn().mockResolvedValue(undefined),
    };

    mockCore.summary = mockSummary as unknown as typeof mockCore.summary;

    (HttpClient as jest.Mock).mockImplementation(() => {
      return {
        post: mockHttpClientPost,
        dispose: jest.fn(),
      };
    });

    // Mock core.getState
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return "https://fly.example.com";
      if (name === STATE_FLY_ACCESS_TOKEN) return "test-access-token";
      return "";
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should send CI end notification with empty payload", async () => {
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => END_CI_RESPONSE_WITH_ARTIFACTS,
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockHttpClientPost).toHaveBeenCalledWith(
      "https://fly.example.com/fly/api/v1/ci/end",
      "{}",
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json",
      }),
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      "✅ CI end notification completed successfully",
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      "Collected 2 artifact(s) from CI workflow",
    );
  });

  it("should parse artifacts from ci/end response and pass to job summary", async () => {
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => END_CI_RESPONSE_WITH_ARTIFACTS,
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockCore.info).toHaveBeenCalledWith(
      "Collected 2 artifact(s) from CI workflow",
    );
    expect(mockCore.info).toHaveBeenCalledWith("📋 Creating job summary...");
  });

  it("should gracefully handle non-JSON ci/end response", async () => {
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "EndCi flow completed successfully",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining("No artifacts in ci/end response"),
    );
    expect(mockCore.info).toHaveBeenCalledWith("📋 Creating job summary...");
  });

  it("should skip notification if URL is not available", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return ""; // No URL
      if (name === STATE_FLY_ACCESS_TOKEN) return "test-access-token";
      return "";
    });

    await runPost();

    expect(mockHttpClientPost).not.toHaveBeenCalled();
    expect(mockCore.info).toHaveBeenCalledWith(
      "No Fly URL found in state, skipping CI end notification",
    );
  });

  it("should skip notification if access token is not available", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return "https://fly.example.com";
      if (name === STATE_FLY_ACCESS_TOKEN) return ""; // No access token
      return "";
    });

    await runPost();

    expect(mockHttpClientPost).not.toHaveBeenCalled();
    expect(mockCore.info).toHaveBeenCalledWith(
      "No access token found in state, skipping CI end notification",
    );
  });

  it("should re-throw errors after all retry attempts fail", async () => {
    mockHttpClientPost.mockRejectedValue(new Error("Network error"));

    await expect(runPost()).rejects.toThrow("Network error");
    // Should have tried 3 times (MAX_RETRIES)
    expect(mockHttpClientPost).toHaveBeenCalledTimes(3);
  }, 15000);

  it("should succeed on retry after initial failure", async () => {
    // First call fails, second succeeds
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => END_CI_RESPONSE_EMPTY,
    } as unknown as HttpClientResponse;
    mockHttpClientPost
      .mockRejectedValueOnce(new Error("Timeout"))
      .mockResolvedValueOnce(fakeResponse);

    await runPost();

    expect(mockHttpClientPost).toHaveBeenCalledTimes(2);
    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining("Request failed (attempt 1/3)"),
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      "✅ CI end notification completed successfully",
    );
  }, 15000);

  it("should retry on 5xx server errors and re-throw after all attempts fail", async () => {
    const fakeErrorResponse: HttpClientResponse = {
      message: { statusCode: 500, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Server error",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeErrorResponse);

    await expect(runPost()).rejects.toThrow(
      "Failed to send CI end notification. Status: 500. Body: Server error",
    );
    expect(mockHttpClientPost).toHaveBeenCalledTimes(3);
    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining("Request failed (attempt 1/3)"),
    );
    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining("Request failed (attempt 2/3)"),
    );
  }, 15000);

  it("should succeed on retry after 5xx followed by 200", async () => {
    const fake502Response: HttpClientResponse = {
      message: { statusCode: 502, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Bad Gateway",
    } as unknown as HttpClientResponse;
    const fakeOkResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => END_CI_RESPONSE_EMPTY,
    } as unknown as HttpClientResponse;
    mockHttpClientPost
      .mockResolvedValueOnce(fake502Response)
      .mockResolvedValueOnce(fakeOkResponse);

    await runPost();

    expect(mockHttpClientPost).toHaveBeenCalledTimes(2);
    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining("Request failed (attempt 1/3)"),
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      "✅ CI end notification completed successfully",
    );
  }, 15000);

  it("should not retry on 4xx client errors", async () => {
    const fake400Response: HttpClientResponse = {
      message: { statusCode: 400, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Bad Request",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fake400Response);

    await expect(runPost()).rejects.toThrow(
      "Failed to send CI end notification. Status: 400. Body: Bad Request",
    );
    expect(mockHttpClientPost).toHaveBeenCalledTimes(1);
  });

  it("should create job summary even with empty artifacts", async () => {
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => END_CI_RESPONSE_EMPTY,
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockCore.info).toHaveBeenCalledWith("📋 Creating job summary...");
  });
});

// Test suite for the mainRunner (now runPostScriptLogic)
describe("runPostScriptLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock core.getState for mainRunner tests
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return "https://fly.example.com";
      if (name === STATE_FLY_ACCESS_TOKEN) return "test-access-token";
      return "";
    });
    // Mock HttpClient for mainRunner tests
    (HttpClient as jest.Mock).mockImplementation(() => {
      return {
        post: mockHttpClientPost,
        dispose: jest.fn(),
      };
    });
  });

  it("should call runPost and not setFailed on success", async () => {
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => END_CI_RESPONSE_EMPTY,
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    // Mock summary for job summary creation
    mockCore.summary = {
      addHeading: jest.fn().mockReturnThis(),
      addRaw: jest.fn().mockReturnThis(),
      addBreak: jest.fn().mockReturnThis(),
      addQuote: jest.fn().mockReturnThis(),
      addTable: jest.fn().mockReturnThis(),
      addLink: jest.fn().mockReturnThis(),
      write: jest.fn().mockResolvedValue(undefined),
    } as unknown as typeof mockCore.summary;

    await runPostScriptLogic();
    expect(mockHttpClientPost).toHaveBeenCalledTimes(1);
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("should call runPost and setFailed on error after all retries", async () => {
    const errorMessage = "Test error from runPost";
    // Reject all retry attempts
    mockHttpClientPost.mockRejectedValue(new Error(errorMessage));

    await runPostScriptLogic();

    // Should have tried 3 times (MAX_RETRIES)
    expect(mockHttpClientPost).toHaveBeenCalledTimes(3);
    expect(core.setFailed).toHaveBeenCalledWith(errorMessage);
  }, 15000);

  it("should handle non-Error objects thrown by runPost after all retries", async () => {
    const errorString = "Just a string error";
    // Reject all retry attempts
    mockHttpClientPost.mockRejectedValue(errorString);

    await runPostScriptLogic();

    // Should have tried 3 times (MAX_RETRIES)
    expect(mockHttpClientPost).toHaveBeenCalledTimes(3);
    expect(core.setFailed).toHaveBeenCalledWith(errorString);
  }, 15000);
});

import * as core from "@actions/core";
import { runPost } from "./post";
import { HttpClient, HttpClientResponse } from "@actions/http-client";
import { IncomingHttpHeaders } from "http";
import { STATE_FLYFROG_JOB_STATUS } from "../src/constants"; // Import the constant

// Mock the dependencies
jest.mock("@actions/core");
jest.mock("@actions/http-client"); // Mock http-client to control post calls

const mockCore = core as jest.Mocked<typeof core>;
const mockPost = jest.fn();

describe("runPost", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup mock for HttpClient constructor and post method
    (HttpClient as jest.Mock).mockImplementation(() => {
      return {
        post: mockPost,
      };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should call notifyCiEnd (via HttpClient.post) when URL and access token are available", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "https://flyfrog.example.com";
      if (name === "flyfrog-access-token") return "test-access-token";
      if (name === "flyfrog-package-managers") return JSON.stringify(["npm", "maven"]);
      if (name === STATE_FLYFROG_JOB_STATUS) return "success"; // Use constant
      return "";
    });
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Build Info published successfully",
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-url");
    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-access-token");
    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-package-managers");
    expect(mockCore.getState).toHaveBeenCalledWith(STATE_FLYFROG_JOB_STATUS); // Use constant for assertion
    expect(mockCore.info).toHaveBeenCalledWith(
      "🏁 Notifying FlyFrog that CI job has ended...",
    );
    expect(mockPost).toHaveBeenCalledWith(
      "https://flyfrog.example.com/flyfrog/api/v1/ci/end",
      JSON.stringify({ status: "success", package_managers: ["npm", "maven"] }),
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json", // Expect lowercase content-type
      }),
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      "✅ CI end notification completed successfully",
    );
  });

  it("should call notifyCiEnd with default status 'unknown' and no package_managers if not set", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "https://flyfrog.example.com";
      if (name === "flyfrog-access-token") return "test-access-token";
      // No package_managers or status in state (STATE_FLYFROG_JOB_STATUS will return "")
      return "";
    });
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockPost).toHaveBeenCalledWith(
      "https://flyfrog.example.com/flyfrog/api/v1/ci/end",
      JSON.stringify({ status: "unknown" }),
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json", // Expect lowercase content-type
      }),
    );
  });

  it("should call notifyCiEnd with provided status and empty package_managers if parsing fails", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "https://flyfrog.example.com";
      if (name === "flyfrog-access-token") return "test-access-token";
      if (name === "flyfrog-package-managers") return "not a json array";
      if (name === STATE_FLYFROG_JOB_STATUS) return "failure"; // Use constant
      return "";
    });
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockPost).toHaveBeenCalledWith(
      "https://flyfrog.example.com/flyfrog/api/v1/ci/end",
      JSON.stringify({ status: "failure" }),
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json", // Expect lowercase content-type
      }),
    );
    expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to parse package managers from state: not a json array"));
  });

  it("should skip notification when no URL is available", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "";
      if (name === "flyfrog-access-token") return "test-access-token";
      return "";
    });

    await runPost();

    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-url");
    expect(mockCore.debug).toHaveBeenCalledWith(
      "No FlyFrog URL found in state, skipping CI end notification",
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("should skip notification when no access token is available", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "https://flyfrog.example.com";
      if (name === "flyfrog-access-token") return "";
      return "";
    });

    await runPost();
    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-url");
    expect(mockCore.getState).toHaveBeenCalledWith("flyfrog-access-token");
    expect(mockCore.debug).toHaveBeenCalledWith(
      "No access token found in state, skipping CI end notification",
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("should throw error when CI end notification (HttpClient.post) fails", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "https://flyfrog.example.com";
      if (name === "flyfrog-access-token") return "test-access-token";
      if (name === STATE_FLYFROG_JOB_STATUS) return "success"; // Use constant
      return "";
    });
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 500, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Internal server error",
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse); // Simulate HTTP error response

    await expect(runPost()).rejects.toThrow(
      "FlyFrog CI end notification failed 500: Internal server error",
    );
    expect(mockPost).toHaveBeenCalledWith(
      "https://flyfrog.example.com/flyfrog/api/v1/ci/end",
      JSON.stringify({ status: "success" }),
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json", // Expect lowercase content-type
      }),
    );
    expect(mockCore.error).toHaveBeenCalledWith(expect.stringContaining("FlyFrog CI end notification failed 500"));
  });

  it("should handle non-Error rejection from HttpClient.post", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === "flyfrog-url") return "https://flyfrog.example.com";
      if (name === "flyfrog-access-token") return "test-access-token";
      return "";
    });
    mockPost.mockRejectedValue("network error"); // Simulate non-Error rejection

    // This test needs to be adjusted based on how runPost's catch block handles non-Error rejections.
    // Assuming the main runPost().catch() in post.ts handles it and calls core.setFailed.
    // For the unit test, we check if the promise from runPost() rejects with the expected value.
    await expect(runPost()).rejects.toBe("network error");
  });
});

// Removed direct tests for notifyCiEnd as it's a local function.
// Its functionality is tested via runPost's tests.

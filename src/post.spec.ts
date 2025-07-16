import * as core from "@actions/core";
import { HttpClient, HttpClientResponse } from "@actions/http-client";
import { IncomingHttpHeaders } from "http";
import {
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PACKAGE_MANAGERS,
} from "./constants";
import { runPost, runPostScriptLogic } from "./post"; // Import with new name

// Mock @actions/core
jest.mock("@actions/core");
jest.mock("@actions/http-client");

const mockCore = core as jest.Mocked<typeof core>;
const mockHttpClientPost = jest.fn(); // Renamed for clarity

describe("runPost", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    (HttpClient as jest.Mock).mockImplementation(() => {
      return {
        post: mockHttpClientPost, // Use renamed mock
      };
    });

    // Mock core.getState
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return "https://fly.example.com";
      if (name === STATE_FLY_ACCESS_TOKEN) return "test-access-token";
      if (name === STATE_FLY_PACKAGE_MANAGERS)
        return JSON.stringify(["npm", "maven"]);
      return "";
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  it("should call notifyCiEnd with status 'success' and package managers if available", async () => {
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockHttpClientPost).toHaveBeenCalledWith(
      "https://fly.example.com/fly/api/v1/ci/end",
      JSON.stringify({ status: "success", package_managers: ["npm", "maven"] }),
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json",
      }),
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      "🏁 Notifying Fly that CI job has ended...",
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      "✅ CI end notification completed successfully",
    );
    expect(mockCore.info).toHaveBeenCalledWith("Job status: success");
  });

  it("should call notifyCiEnd with status 'success' and no package managers if not available", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return "https://fly.example.com";
      if (name === STATE_FLY_ACCESS_TOKEN) return "test-access-token";
      if (name === STATE_FLY_PACKAGE_MANAGERS) return ""; // No package managers
      return "";
    });

    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockHttpClientPost).toHaveBeenCalledWith(
      "https://fly.example.com/fly/api/v1/ci/end",
      JSON.stringify({ status: "success" }),
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json",
      }),
    );
    expect(mockCore.info).toHaveBeenCalledWith("Job status: success");
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

  it("should re-throw errors during HTTP client post operation", async () => {
    // Standard mock for getState, ensuring URL and token are present
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return "https://fly.example.com";
      if (name === STATE_FLY_ACCESS_TOKEN) return "test-access-token";
      return "";
    });
    mockHttpClientPost.mockRejectedValue(new Error("Network error"));

    await expect(runPost()).rejects.toThrow("Network error");
  });

  it("should re-throw error if HTTP response is not 200", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return "https://fly.example.com";
      if (name === STATE_FLY_ACCESS_TOKEN) return "test-access-token";
      return "";
    });

    const fakeErrorResponse: HttpClientResponse = {
      message: { statusCode: 500, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Server error",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeErrorResponse);

    await expect(runPost()).rejects.toThrow(
      "Failed to send CI end notification. Status: 500. Body: Server error",
    );
  });

  it("should warn if package managers string is invalid JSON and send request without them", async () => {
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return "https://fly.example.com";
      if (name === STATE_FLY_ACCESS_TOKEN) return "test-access-token";
      if (name === STATE_FLY_PACKAGE_MANAGERS) return "invalid-json";
      return "";
    });

    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to parse package managers from state: invalid-json. Error: Unexpected token 'i', \"invalid-json\" is not valid JSON",
      ),
    );
    expect(mockHttpClientPost).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ status: "success" }), // Should send with status: "success" only
      expect.any(Object),
    );
  });
});

// Test suite for the mainRunner (now runPostScriptLogic)
describe("runPostScriptLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock core.getState for mainRunner tests as well, if runPost is called internally
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return "https://fly.example.com";
      if (name === STATE_FLY_ACCESS_TOKEN) return "test-access-token";
      return "";
    });
    // Mock HttpClient for mainRunner tests
    (HttpClient as jest.Mock).mockImplementation(() => {
      return {
        post: mockHttpClientPost,
      };
    });
  });

  it("should call runPost and not setFailed on success", async () => {
    // runPost is mocked to resolve successfully by default in beforeEach
    await runPostScriptLogic();
    expect(mockHttpClientPost).toHaveBeenCalledTimes(1);
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("should call runPost and setFailed on error", async () => {
    const errorMessage = "Test error from runPost";
    mockHttpClientPost.mockRejectedValueOnce(new Error(errorMessage));

    await runPostScriptLogic();

    expect(mockHttpClientPost).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenCalledWith(errorMessage);
  });

  it("should handle non-Error objects thrown by runPost", async () => {
    const errorString = "Just a string error";
    mockHttpClientPost.mockRejectedValueOnce(errorString);

    await runPostScriptLogic();

    expect(mockHttpClientPost).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenCalledWith(errorString);
  });
});

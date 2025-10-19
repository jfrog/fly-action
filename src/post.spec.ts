// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { HttpClient, HttpClientResponse } from "@actions/http-client";
import { IncomingHttpHeaders } from "http";
import * as github from "@actions/github";
import {
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PACKAGE_MANAGERS,
} from "./constants";
import {
  runPost,
  runPostScriptLogic,
  filterMainSteps,
  analyzeJobSteps,
} from "./post";

// Mock @actions/core
jest.mock("@actions/core");
jest.mock("@actions/http-client");
jest.mock("@actions/github", () => ({
  getOctokit: jest.fn(),
}));

const mockCore = core as jest.Mocked<typeof core>;
const mockHttpClientPost = jest.fn(); // Renamed for clarity
const mockGithub = github as jest.Mocked<typeof github>;

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

// Helper function to create mock GitHub API responses
const createMockOctokit = (workflowRun: unknown, jobs: unknown) => ({
  rest: {
    actions: {
      getWorkflowRun: jest.fn().mockResolvedValue({ data: workflowRun }),
      listJobsForWorkflowRun: jest.fn().mockResolvedValue({ data: jobs }),
    },
  },
});

// Helper function to create mock workflow run
const createMockWorkflowRun = (status = "in_progress", conclusion = null) => ({
  status,
  conclusion,
});

// Helper function to create mock job with steps
const createMockJob = (
  name: string,
  status = "in_progress",
  conclusion = null,
  steps: Array<{ name: string; conclusion: string | null }> = [],
) => ({
  name,
  status,
  conclusion,
  steps,
});

// Helper function to create mock step
const createMockStep = (name: string, conclusion: string | null = null) => ({
  name,
  conclusion,
});

describe("runPost", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      GITHUB_RUN_ID: "123456789",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_TOKEN: "fake-token",
      GITHUB_JOB: "test-job",
    };

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
        post: mockHttpClientPost, // Use renamed mock
        dispose: jest.fn(), // Add dispose method to mock
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

  it("should call notifyCiEnd with status 'success' when all steps succeeded", async () => {
    // Mock successful workflow with successful steps
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
          createMockStep("Build", "success"),
          createMockStep("Test", "success"),
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

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
    expect(mockCore.info).toHaveBeenCalledWith("✅ All main steps succeeded");
  });

  it("should call notifyCiEnd with status 'failure' when a step failed", async () => {
    // Mock workflow with one failed step
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
          createMockStep("Build", "failure"),
          createMockStep("Test", "success"),
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockHttpClientPost).toHaveBeenCalledWith(
      "https://fly.example.com/fly/api/v1/ci/end",
      JSON.stringify({ status: "failure", package_managers: ["npm", "maven"] }),
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json",
      }),
    );
    expect(mockCore.info).toHaveBeenCalledWith("Job status: failure");
    expect(mockCore.info).toHaveBeenCalledWith(
      "❌ At least one main step failed",
    );
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
    // Mock successful workflow for status checking
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

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
    // Mock successful workflow for status checking
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

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
    // Mock successful workflow for status checking
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

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
        "Failed to parse package managers from state: invalid-json. Error: Unexpected token",
      ),
    );
    expect(mockHttpClientPost).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ status: "success" }), // Should send with status: "success" only
      expect.any(Object),
    );
  });

  it("should fallback to success when GitHub environment variables are missing", async () => {
    // Remove GitHub environment variables
    process.env.GITHUB_RUN_ID = "";
    process.env.GITHUB_REPOSITORY = "";
    process.env.GITHUB_TOKEN = "";

    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockHttpClientPost).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ status: "success", package_managers: ["npm", "maven"] }),
      expect.any(Object),
    );
    expect(mockCore.warning).toHaveBeenCalledWith(
      "Missing GitHub environment variables, assuming job succeeded since post action is running",
    );
  });

  it("should handle GitHub API errors gracefully", async () => {
    // Mock GitHub API error
    const mockOctokit = {
      rest: {
        actions: {
          listJobsForWorkflowRun: jest
            .fn()
            .mockRejectedValue(new Error("API Error")),
        },
      },
    };
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockCore.warning).toHaveBeenCalledWith(
      "Failed to check job status via GitHub API: Error: API Error",
    );
    expect(mockHttpClientPost).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ status: "success", package_managers: ["npm", "maven"] }),
      expect.any(Object),
    );
  });

  it("should exclude post action steps from failure detection", async () => {
    // Mock workflow with post action steps that should be ignored
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
          createMockStep("Build", "success"),
          createMockStep("Post Setup Fly Registry", "failure"), // This should be ignored
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    // Should be success because we ignore post action failures
    expect(mockHttpClientPost).toHaveBeenCalledWith(
      "https://fly.example.com/fly/api/v1/ci/end",
      JSON.stringify({ status: "success", package_managers: ["npm", "maven"] }),
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json",
      }),
    );
  });

  it("should handle cancelled steps as failures", async () => {
    // Mock workflow with cancelled step
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
          createMockStep("Build", "cancelled"),
          createMockStep("Test", "success"),
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockHttpClientPost).toHaveBeenCalledWith(
      "https://fly.example.com/fly/api/v1/ci/end",
      JSON.stringify({ status: "failure", package_managers: ["npm", "maven"] }),
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json",
      }),
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      "❌ At least one main step failed",
    );
  });

  it("should handle job with no steps array", async () => {
    // Mock workflow with job that has no steps
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, []), // Empty steps array
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

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
  });

  it("should handle job with undefined steps property", async () => {
    // Mock workflow where currentJob.steps is undefined
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        {
          name: "test-job",
          status: "in_progress",
          conclusion: null,
          steps: undefined, // Explicitly undefined
        },
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

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
  });

  it("should handle job not found in API response", async () => {
    // Mock workflow where the job name doesn't match
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("different-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPost();

    expect(mockCore.warning).toHaveBeenCalledWith(
      "Could not determine job status precisely, assuming success since post action is executing",
    );
    expect(mockHttpClientPost).toHaveBeenCalledWith(
      "https://fly.example.com/fly/api/v1/ci/end",
      JSON.stringify({ status: "success", package_managers: ["npm", "maven"] }),
      expect.objectContaining({
        Authorization: "Bearer test-access-token",
        "content-type": "application/json",
      }),
    );
  });
});

// Unit tests for helper functions
describe("filterMainSteps", () => {
  it("should return empty array for empty input", () => {
    const result = filterMainSteps([]);
    expect(result).toEqual([]);
  });

  it("should filter out post steps", () => {
    const steps = [
      { name: "Checkout", conclusion: "success" },
      { name: "Build", conclusion: "success" },
      { name: "Post Setup", conclusion: "success" },
      { name: "POST Another Action", conclusion: "failure" },
    ];
    const result = filterMainSteps(steps);
    expect(result).toEqual([
      { name: "Checkout", conclusion: "success" },
      { name: "Build", conclusion: "success" },
    ]);
  });

  it("should handle steps with undefined names", () => {
    const steps = [
      { name: "Checkout", conclusion: "success" },
      { name: undefined, conclusion: "success" },
      { name: undefined, conclusion: "success" },
    ];
    const result = filterMainSteps(steps);
    expect(result).toEqual([
      { name: "Checkout", conclusion: "success" },
      { name: undefined, conclusion: "success" },
      { name: undefined, conclusion: "success" },
    ]);
  });

  it("should be case insensitive for post step detection", () => {
    const steps = [
      { name: "Checkout", conclusion: "success" },
      { name: "post setup", conclusion: "success" },
      { name: "POST teardown", conclusion: "success" },
      { name: "Post Cleanup", conclusion: "success" },
    ];
    const result = filterMainSteps(steps);
    expect(result).toEqual([{ name: "Checkout", conclusion: "success" }]);
  });

  it("should return all steps when no post steps exist", () => {
    const steps = [
      { name: "Checkout", conclusion: "success" },
      { name: "Build", conclusion: "failure" },
      { name: "Test", conclusion: "success" },
    ];
    const result = filterMainSteps(steps);
    expect(result).toEqual(steps);
  });

  it("should return empty array when all steps are post steps", () => {
    const steps = [
      { name: "Post Setup", conclusion: "success" },
      { name: "Post Cleanup", conclusion: "failure" },
    ];
    const result = filterMainSteps(steps);
    expect(result).toEqual([]);
  });
});

describe("analyzeJobSteps", () => {
  const mockCoreInfo = jest.spyOn(core, "info");

  beforeEach(() => {
    mockCoreInfo.mockClear();
  });

  it("should return success for empty steps array", () => {
    const result = analyzeJobSteps([]);
    expect(result).toBe("success");
    expect(mockCoreInfo).toHaveBeenCalledWith("✅ All main steps succeeded");
  });

  it("should return success when all main steps succeeded", () => {
    const steps = [
      { name: "Checkout", conclusion: "success" },
      { name: "Build", conclusion: "success" },
      { name: "Post Cleanup", conclusion: "failure" }, // Should be ignored
    ];
    const result = analyzeJobSteps(steps);
    expect(result).toBe("success");
    expect(mockCoreInfo).toHaveBeenCalledWith("✅ All main steps succeeded");
  });

  it("should return failure when any main step failed", () => {
    const steps = [
      { name: "Checkout", conclusion: "success" },
      { name: "Build", conclusion: "failure" },
      { name: "Test", conclusion: "success" },
    ];
    const result = analyzeJobSteps(steps);
    expect(result).toBe("failure");
    expect(mockCoreInfo).toHaveBeenCalledWith(
      "❌ At least one main step failed",
    );
  });

  it("should return failure when any main step was cancelled", () => {
    const steps = [
      { name: "Checkout", conclusion: "success" },
      { name: "Build", conclusion: "cancelled" },
    ];
    const result = analyzeJobSteps(steps);
    expect(result).toBe("failure");
    expect(mockCoreInfo).toHaveBeenCalledWith(
      "❌ At least one main step failed",
    );
  });

  it("should return success when only post steps failed", () => {
    const steps = [
      { name: "Checkout", conclusion: "success" },
      { name: "Build", conclusion: "success" },
      { name: "Post Setup", conclusion: "failure" },
      { name: "Post Cleanup", conclusion: "cancelled" },
    ];
    const result = analyzeJobSteps(steps);
    expect(result).toBe("success");
    expect(mockCoreInfo).toHaveBeenCalledWith("✅ All main steps succeeded");
  });

  it("should handle steps with null conclusions as non-failures", () => {
    const steps = [
      { name: "Checkout", conclusion: "success" },
      { name: "Build", conclusion: null },
      { name: "Test", conclusion: "in_progress" },
    ];
    const result = analyzeJobSteps(steps);
    expect(result).toBe("success");
    expect(mockCoreInfo).toHaveBeenCalledWith("✅ All main steps succeeded");
  });

  it("should handle mixed success and skipped steps", () => {
    const steps = [
      { name: "Checkout", conclusion: "success" },
      { name: "Build", conclusion: "success" },
      { name: "Test", conclusion: "skipped" }, // Not failure/cancelled
      { name: "Deploy", conclusion: "neutral" }, // Not failure/cancelled
    ];
    const result = analyzeJobSteps(steps);
    expect(result).toBe("success");
    expect(mockCoreInfo).toHaveBeenCalledWith("✅ All main steps succeeded");
  });
});

// Test suite for the mainRunner (now runPostScriptLogic)
describe("runPostScriptLogic", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      GITHUB_RUN_ID: "123456789",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_TOKEN: "fake-token",
      GITHUB_JOB: "test-job",
    };

    // Mock core.getState for mainRunner tests as well, if runPost is called internally
    mockCore.getState.mockImplementation((name: string) => {
      if (name === STATE_FLY_URL) return "https://fly.example.com";
      if (name === STATE_FLY_ACCESS_TOKEN) return "test-access-token";
      if (name === STATE_FLY_PACKAGE_MANAGERS) return JSON.stringify(["npm"]);
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

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should call runPost and not setFailed on success", async () => {
    // Mock successful workflow
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
          createMockStep("Build", "success"),
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

    // Mock successful HTTP response
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Notification sent",
    } as unknown as HttpClientResponse;
    mockHttpClientPost.mockResolvedValue(fakeResponse);

    await runPostScriptLogic();
    expect(mockHttpClientPost).toHaveBeenCalledTimes(1);
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("should call runPost and setFailed on error", async () => {
    // Mock successful workflow setup but HTTP error
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

    const errorMessage = "Test error from runPost";
    mockHttpClientPost.mockRejectedValueOnce(new Error(errorMessage));

    await runPostScriptLogic();

    expect(mockHttpClientPost).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenCalledWith(errorMessage);
  });

  it("should handle non-Error objects thrown by runPost", async () => {
    // Mock successful workflow setup but string error
    const workflowRun = createMockWorkflowRun("in_progress", null);
    const jobs = {
      jobs: [
        createMockJob("test-job", "in_progress", null, [
          createMockStep("Checkout", "success"),
        ]),
      ],
    };

    const mockOctokit = createMockOctokit(workflowRun, jobs);
    mockGithub.getOctokit.mockReturnValue(
      mockOctokit as unknown as ReturnType<typeof mockGithub.getOctokit>,
    );

    const errorString = "Just a string error";
    mockHttpClientPost.mockRejectedValueOnce(errorString);

    await runPostScriptLogic();

    expect(mockHttpClientPost).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenCalledWith(errorString);
  });
});

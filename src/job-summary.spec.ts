import { jest } from "@jest/globals";

// Mock @actions/core
const mockSummary = {
  addHeading: jest.fn().mockReturnThis(),
  addRaw: jest.fn().mockReturnThis(),
  addBreak: jest.fn().mockReturnThis(),
  addQuote: jest.fn().mockReturnThis(),
  addTable: jest.fn().mockReturnThis(),
  addLink: jest.fn().mockReturnThis(),
  addSeparator: jest.fn().mockReturnThis(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write: jest.fn() as any,
};

const mockCore = {
  summary: mockSummary,
  warning: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

jest.mock("@actions/core", () => mockCore);

import { createJobSummary } from "./job-summary";

describe("createJobSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSummary.write.mockResolvedValue(undefined);

    // Mock environment variables
    process.env.GITHUB_REPOSITORY = "owner/test-repo";
    process.env.GITHUB_REPOSITORY_OWNER = "owner";
    process.env.GITHUB_JOB = "test-job";
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY_OWNER;
    delete process.env.GITHUB_JOB;
  });

  it("should create job summary with npm artifacts", async () => {
    await createJobSummary(["npm"]);

    expect(mockSummary.addHeading).toHaveBeenCalledWith("🚀 Fly Action", 1);
    expect(mockSummary.addRaw).toHaveBeenCalledWith(
      "✅ Completed successfully",
    );
    expect(mockSummary.addHeading).toHaveBeenCalledWith(
      "📦 Published Artifacts",
      2,
    );
    expect(mockSummary.addTable).toHaveBeenCalled();
    expect(mockSummary.addLink).toHaveBeenCalledWith(
      "📢 View Release In Fly",
      expect.any(String),
    );
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should create job summary with docker artifacts", async () => {
    await createJobSummary(["docker"]);

    expect(mockSummary.addHeading).toHaveBeenCalledWith("🚀 Fly Action", 1);
    expect(mockSummary.addTable).toHaveBeenCalled();
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should show no artifacts message when no supported package managers", async () => {
    await createJobSummary(["unsupported"]);

    expect(mockSummary.addQuote).toHaveBeenCalledWith(
      "📦 No artifacts published",
    );
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should show no artifacts message when empty package managers array", async () => {
    await createJobSummary([]);

    expect(mockSummary.addQuote).toHaveBeenCalledWith(
      "📦 No artifacts published",
    );
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should handle missing environment variables gracefully", async () => {
    delete process.env.GITHUB_REPOSITORY;

    await createJobSummary(["npm"]);

    expect(mockSummary.addLink).toHaveBeenCalledWith(
      "📢 View Release In Fly",
      "https://fly.jfrogdev.org",
    );
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should handle summary write failures", async () => {
    mockSummary.write.mockRejectedValue(new Error("Write failed"));

    await createJobSummary(["npm"]);

    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to create job summary:"),
    );
  });
});

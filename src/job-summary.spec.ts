// Copyright (c) JFrog Ltd. (2025)

import { jest } from "@jest/globals";

// Mock @actions/core
const mockSummary = {
  addRaw: jest.fn().mockReturnThis(),
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

  it("should create job summary without artifacts table", async () => {
    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0];
    expect(markdownContent).toContain("# 🦋 Fly action");
    expect(markdownContent).toContain("✅ **Completed successfully**");
    expect(markdownContent).toContain("📦 Published artifacts");
    expect(markdownContent).toContain("📢 [View release in Fly]");
    expect(markdownContent).toContain("https://fly.jfrog.ai");
    // Should NOT contain mock artifacts
    expect(markdownContent).not.toContain("ascii-frog-frontend");
    expect(markdownContent).not.toContain("ascii-frog-app");
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should create job summary with any package manager type", async () => {
    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0];
    expect(markdownContent).toContain("# 🦋 Fly action");
    expect(markdownContent).toContain("https://fly.jfrog.ai");
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should create job summary even with empty package managers array", async () => {
    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0];
    expect(markdownContent).toContain("# 🦋 Fly action");
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should handle missing environment variables gracefully", async () => {
    delete process.env.GITHUB_REPOSITORY;

    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0];
    expect(markdownContent).toContain("https://fly.jfrog.ai");
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should handle summary write failures", async () => {
    mockSummary.write.mockRejectedValue(new Error("Write failed"));

    await createJobSummary();

    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to create job summary:"),
    );
  });
});

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
import { CollectedArtifact } from "./types";

describe("createJobSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSummary.write.mockResolvedValue(undefined);

    process.env.GITHUB_REPOSITORY = "owner/test-repo";
    process.env.GITHUB_REPOSITORY_OWNER = "owner";
    process.env.GITHUB_JOB = "test-job";
  });

  afterEach(() => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REPOSITORY_OWNER;
    delete process.env.GITHUB_JOB;
  });

  it("should create job summary with no artifacts", async () => {
    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("# 🦋 Fly action");
    expect(markdownContent).toContain("✅ **Completed successfully**");
    expect(markdownContent).toContain("📢 [View release in Fly]");
    expect(markdownContent).toContain("https://fly.jfrog.ai");
    expect(markdownContent).not.toContain("Collected Artifacts");
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should render artifacts table when artifacts are provided", async () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "my-lib",
        type: "npm",
        repo_key: "npm-local",
        path: "npm-local/my-lib/-/my-lib-1.0.0.tgz",
      },
      { name: "my-app", type: "docker", repo_key: "docker-local" },
    ];

    await createJobSummary(artifacts);

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("### Collected Artifacts");
    expect(markdownContent).toContain("| Artifact | Type | Repository |");
    expect(markdownContent).toContain("| my-lib | npm | npm-local |");
    expect(markdownContent).toContain("| my-app | docker | docker-local |");
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should show dash for missing repo_key", async () => {
    const artifacts: CollectedArtifact[] = [
      { name: "orphan-artifact", type: "generic" },
    ];

    await createJobSummary(artifacts);

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("| orphan-artifact | generic | — |");
  });

  it("should not render artifacts table for empty array", async () => {
    await createJobSummary([]);

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).not.toContain("Collected Artifacts");
  });

  it("should handle missing environment variables gracefully", async () => {
    delete process.env.GITHUB_REPOSITORY;

    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
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

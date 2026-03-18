// Copyright (c) JFrog Ltd. (2025)

import { vi } from "vitest";

// vi.hoisted runs before vi.mock hoisting — safe to reference in factory
const { mockSummary, mockCore } = vi.hoisted(() => {
  const mockSummary = {
    addRaw: vi.fn().mockReturnThis(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    write: vi.fn() as any,
  };
  const mockCore = {
    summary: mockSummary,
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };
  return { mockSummary, mockCore };
});

vi.mock("@actions/core", () => mockCore);

import { createJobSummary } from "./job-summary";
import { CollectedArtifact } from "./types";

describe("createJobSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("should escape pipe characters in artifact data", async () => {
    const artifacts: CollectedArtifact[] = [
      { name: "my|lib", type: "npm|pnpm", repo_key: "local|remote" },
    ];

    await createJobSummary(artifacts);

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain(
      "| my\\|lib | npm\\|pnpm | local\\|remote |",
    );
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

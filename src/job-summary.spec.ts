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

import {
  createJobSummary,
  parseTransferResults,
  buildTransfersTable,
} from "./job-summary";
import { CollectedArtifact, TransferSummaryEntry } from "./types";
import { ENV_FLY_TRANSFER_RESULTS } from "./constants";

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
    delete process.env[ENV_FLY_TRANSFER_RESULTS];
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
        path: "npm-local/my-lib/-/my-lib-1.0.0.tgz",
      },
      { name: "my-app", type: "docker" },
    ];

    await createJobSummary(artifacts);

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("### Collected Artifacts");
    expect(markdownContent).toContain("| Artifact | Type |");
    expect(markdownContent).toContain("| my-lib | npm |");
    expect(markdownContent).toContain("| my-app | docker |");
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should escape pipe characters in artifact data", async () => {
    const artifacts: CollectedArtifact[] = [
      { name: "my|lib", type: "npm|pnpm" },
    ];

    await createJobSummary(artifacts);

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("| my\\|lib | npm\\|pnpm |");
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

  it("should use custom platform URL when provided", async () => {
    await createJobSummary([], "https://fly.jfrog.info");

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("https://fly.jfrog.info");
    expect(markdownContent).not.toContain("https://fly.jfrog.ai");
  });

  it("should handle summary write failures", async () => {
    mockSummary.write.mockRejectedValue(new Error("Write failed"));

    await createJobSummary();

    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to create job summary:"),
    );
  });

  it("should render transfers table from env var", async () => {
    const entry: TransferSummaryEntry = {
      type: "upload",
      name: "my-app",
      version: "1.0.0",
      results: [
        { name: "app.zip", status: "success" },
        { name: "app.tar.gz", status: "error", message: "checksum" },
      ],
    };
    process.env[ENV_FLY_TRANSFER_RESULTS] = JSON.stringify(entry);

    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("### Uploads & Downloads");
    expect(markdownContent).toContain(
      "| ⬆️ | upload | my-app | 1.0.0 | app.zip | ✅ success |",
    );
    expect(markdownContent).toContain(
      "| ⬆️ | upload | my-app | 1.0.0 | app.tar.gz | ❌ error |",
    );
  });

  it("should render multiple transfer entries", async () => {
    const line1 = JSON.stringify({
      type: "upload",
      name: "pkg-a",
      version: "1.0.0",
      results: [{ name: "a.zip", status: "success" }],
    });
    const line2 = JSON.stringify({
      type: "download",
      name: "pkg-b",
      version: "2.0.0",
      results: [{ name: "b.zip", status: "success" }],
    });
    process.env[ENV_FLY_TRANSFER_RESULTS] = `${line1}\n${line2}`;

    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain(
      "| ⬆️ | upload | pkg-a | 1.0.0 | a.zip | ✅ success |",
    );
    expect(markdownContent).toContain(
      "| ⬇️ | download | pkg-b | 2.0.0 | b.zip | ✅ success |",
    );
  });

  it("should not render transfers table when env var is empty", async () => {
    delete process.env[ENV_FLY_TRANSFER_RESULTS];

    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).not.toContain("Uploads & Downloads");
  });

  it("should warn on malformed transfer results JSON", async () => {
    process.env[ENV_FLY_TRANSFER_RESULTS] = "not valid json";

    await createJobSummary();

    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse transfer results"),
    );
  });
});

describe("parseTransferResults", () => {
  it("parses JSON lines into entries", () => {
    const line1 = JSON.stringify({
      type: "upload",
      name: "a",
      version: "1.0",
      results: [],
    });
    const line2 = JSON.stringify({
      type: "download",
      name: "b",
      version: "2.0",
      results: [{ name: "f.zip", status: "success" }],
    });

    const entries = parseTransferResults(`${line1}\n${line2}`);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("upload");
    expect(entries[1].type).toBe("download");
    expect(entries[1].results).toHaveLength(1);
  });

  it("returns empty array for empty string", () => {
    expect(parseTransferResults("")).toEqual([]);
    expect(parseTransferResults("  \n  ")).toEqual([]);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseTransferResults("bad json")).toThrow();
  });
});

describe("buildTransfersTable", () => {
  it("returns empty string for no entries", () => {
    expect(buildTransfersTable([])).toBe("");
  });

  it("renders table with correct columns", () => {
    const entries: TransferSummaryEntry[] = [
      {
        type: "upload",
        name: "my-app",
        version: "1.0.0",
        results: [{ name: "file.zip", status: "success" }],
      },
    ];

    const table = buildTransfersTable(entries);
    expect(table).toContain("### Uploads & Downloads");
    expect(table).toContain("| | Type | Package | Version | File | Status |");
    expect(table).toContain(
      "| ⬆️ | upload | my-app | 1.0.0 | file.zip | ✅ success |",
    );
  });

  it("uses correct icons for upload and download", () => {
    const entries: TransferSummaryEntry[] = [
      {
        type: "upload",
        name: "a",
        version: "1.0",
        results: [{ name: "up.zip", status: "success" }],
      },
      {
        type: "download",
        name: "b",
        version: "2.0",
        results: [{ name: "down.zip", status: "success" }],
      },
    ];

    const table = buildTransfersTable(entries);
    expect(table).toContain("| ⬆️ | upload |");
    expect(table).toContain("| ⬇️ | download |");
  });

  it("uses correct status icons", () => {
    const entries: TransferSummaryEntry[] = [
      {
        type: "upload",
        name: "pkg",
        version: "1.0",
        results: [
          { name: "ok.zip", status: "success" },
          { name: "fail.zip", status: "error", message: "oops" },
          { name: "other.zip", status: "configured" },
        ],
      },
    ];

    const table = buildTransfersTable(entries);
    expect(table).toContain("✅ success");
    expect(table).toContain("❌ error");
    expect(table).toContain("ℹ️ configured");
  });

  it("escapes pipe characters in data", () => {
    const entries: TransferSummaryEntry[] = [
      {
        type: "upload",
        name: "my|pkg",
        version: "1|0",
        results: [{ name: "a|b.zip", status: "success" }],
      },
    ];

    const table = buildTransfersTable(entries);
    expect(table).toContain("my\\|pkg");
    expect(table).toContain("1\\|0");
    expect(table).toContain("a\\|b.zip");
  });
});

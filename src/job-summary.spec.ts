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
    getState: vi.fn(),
  };
  return { mockSummary, mockCore };
});

vi.mock("@actions/core", () => mockCore);

import {
  createJobSummary,
  parseTransferResults,
  buildTransfersTable,
  buildDistributedTable,
  buildArtifactsTable,
  formatSize,
} from "./job-summary";
import {
  CollectedArtifact,
  DistributeResponse,
  TransferSummaryEntry,
} from "./types";
import {
  ENV_FLY_TRANSFER_RESULTS,
  ENV_FLY_DISTRIBUTE_RESULTS,
} from "./constants";

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
    delete process.env[ENV_FLY_DISTRIBUTE_RESULTS];
  });

  it("should create job summary with no artifacts", async () => {
    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("## test-job");
    expect(markdownContent).toContain("[View release in Fly]");
    expect(markdownContent).toContain("https://fly.jfrog.ai");
    expect(markdownContent).not.toContain("Collected Artifacts");
    expect(mockSummary.write).toHaveBeenCalled();
  });

  it("should use GITHUB_JOB as section title", async () => {
    process.env.GITHUB_JOB = "docker-release";
    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("## docker-release");
  });

  it("should render resolved artifacts table when artifacts are provided", async () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "my-lib-1.0.0.tgz",
        type: "npm",
        path: "my-lib/-/my-lib-1.0.0.tgz",
      },
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/my-app/v2.0.0/manifest.json",
      },
    ];

    await createJobSummary(artifacts);

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("### Collected Artifacts");
    expect(markdownContent).toContain("| Type | Package | Version |");
    expect(markdownContent).toContain("| npm | my-lib | 1.0.0 |");
    expect(markdownContent).toContain("| docker | myorg/my-app | v2.0.0 |");
    expect(mockSummary.write).toHaveBeenCalled();
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
        { name: "app.tar.gz", status: "error" },
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

  it("should render distributed table when env var has results", async () => {
    const results: DistributeResponse[] = [
      {
        package_name: "my-app",
        package_version: "1.0.0",
        package_type: "generic",
        public_url:
          "https://fly.example.com/public/generic/tenant/my-app/1.0.0",
        download_url:
          "https://fly.example.com/public/generic/tenant/my-app/1.0.0/my-app.tar.gz",
        download_count: 0,
      },
    ];
    process.env[ENV_FLY_DISTRIBUTE_RESULTS] = JSON.stringify(results);

    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("### 🌐 Distributed Artifacts");
    expect(markdownContent).toContain("my-app");
    expect(markdownContent).toContain("1.0.0");
    expect(markdownContent).toContain("my-app.tar.gz");
  });

  it("should not render distributed table when env var is empty", async () => {
    delete process.env[ENV_FLY_DISTRIBUTE_RESULTS];

    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).not.toContain("Distributed Artifacts");
  });

  // Issue #69: the env var now carries only the slim summary projection
  // (no `download_count`, no `files[]`). Verify the post step still renders a
  // complete table — including the docker pull command — from that shape alone.
  it("renders the distributed table from the slim env projection (no download_count/files)", async () => {
    const slim = [
      {
        package_name: "my-app",
        package_version: "1.0.0",
        package_type: "generic",
        public_url:
          "https://fly.example.com/public/generic/tenant/my-app/1.0.0",
        download_url:
          "https://fly.example.com/public/generic/tenant/my-app/1.0.0/my-app.tar.gz",
      },
      {
        package_name: "myorg/my-image",
        package_version: "2.0.0",
        package_type: "docker",
        public_url: "https://flyjfrog.jfrog.io/v2/docker-public/myorg/my-image",
        download_url:
          "https://flyjfrog.jfrog.io/v2/docker-public/myorg/my-image/manifests/2.0.0",
      },
    ];
    process.env[ENV_FLY_DISTRIBUTE_RESULTS] = JSON.stringify(slim);

    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("### 🌐 Distributed Artifacts");
    expect(markdownContent).toContain("my-app.tar.gz");
    expect(markdownContent).toContain(
      "docker pull flyjfrog.jfrog.io/docker-public/myorg/my-image:2.0.0",
    );
  });

  it("should render all rows when env var contains multiple newline-separated JSON arrays (multi-step accumulation)", async () => {
    const step1: DistributeResponse[] = [
      {
        package_name: "my-app",
        package_version: "1.0.0",
        package_type: "generic",
        public_url:
          "https://fly.example.com/public/generic/tenant/my-app/1.0.0",
        download_url:
          "https://fly.example.com/public/generic/tenant/my-app/1.0.0/my-app.tar.gz",
        download_count: 0,
      },
    ];
    const step2: DistributeResponse[] = [
      {
        package_name: "my-lib",
        package_version: "2.3.1",
        package_type: "generic",
        public_url:
          "https://fly.example.com/public/generic/tenant/my-lib/2.3.1",
        download_url:
          "https://fly.example.com/public/generic/tenant/my-lib/2.3.1/my-lib.tar.gz",
        download_count: 0,
      },
    ];
    process.env[ENV_FLY_DISTRIBUTE_RESULTS] =
      `${JSON.stringify(step1)}\n${JSON.stringify(step2)}`;

    await createJobSummary();

    const markdownContent = mockSummary.addRaw.mock.calls[0][0] as string;
    expect(markdownContent).toContain("### 🌐 Distributed Artifacts");
    expect(markdownContent).toContain("my-app");
    expect(markdownContent).toContain("my-lib");
    expect(markdownContent).toContain("1.0.0");
    expect(markdownContent).toContain("2.3.1");
  });

  it("should warn on malformed distribute results JSON", async () => {
    process.env[ENV_FLY_DISTRIBUTE_RESULTS] = "not valid json";

    await createJobSummary();

    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse distribute results"),
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
          { name: "fail.zip", status: "error" },
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

describe("buildDistributedTable", () => {
  it("returns empty string for no results", () => {
    expect(buildDistributedTable([])).toBe("");
  });

  it("renders table with correct header and columns", () => {
    const results: DistributeResponse[] = [
      {
        package_name: "my-app",
        package_version: "1.0.0",
        package_type: "generic",
        public_url:
          "https://fly.example.com/public/generic/tenant/my-app/1.0.0",
        download_url:
          "https://fly.example.com/public/generic/tenant/my-app/1.0.0/my-app.tar.gz",
        download_count: 5,
      },
    ];

    const table = buildDistributedTable(results);
    expect(table).toContain("### 🌐 Distributed Artifacts");
    expect(table).toContain("| Package | Version | Download URL |");
    expect(table).toContain("| my-app | 1.0.0 |");
    expect(table).toContain("my-app.tar.gz");
  });

  it("renders a linked download URL", () => {
    const url =
      "https://fly.example.com/public/generic/tenant/my-app/1.0.0/my-app.tar.gz";
    const results: DistributeResponse[] = [
      {
        package_name: "my-app",
        package_version: "1.0.0",
        package_type: "generic",
        public_url:
          "https://fly.example.com/public/generic/tenant/my-app/1.0.0",
        download_url: url,
        download_count: 0,
      },
    ];

    const table = buildDistributedTable(results);
    expect(table).toContain(`[${url}](${url})`);
  });

  it("renders multiple results as separate rows", () => {
    const results: DistributeResponse[] = [
      {
        package_name: "app-a",
        package_version: "1.0.0",
        package_type: "generic",
        public_url: "https://example.com/a",
        download_url: "https://example.com/a/a.tar.gz",
        download_count: 0,
      },
      {
        package_name: "app-b",
        package_version: "2.0.0",
        package_type: "generic",
        public_url: "https://example.com/b",
        download_url: "https://example.com/b/b.tar.gz",
        download_count: 0,
      },
    ];

    const table = buildDistributedTable(results);
    expect(table).toContain("| app-a | 1.0.0 |");
    expect(table).toContain("| app-b | 2.0.0 |");
  });

  it("escapes pipe characters in package name and version", () => {
    const results: DistributeResponse[] = [
      {
        package_name: "my|app",
        package_version: "1|0",
        package_type: "generic",
        public_url: "https://example.com/u",
        download_url: "https://example.com/d",
        download_count: 0,
      },
    ];

    const table = buildDistributedTable(results);
    expect(table).toContain("my\\|app");
    expect(table).toContain("1\\|0");
  });

  it("renders docker rows with a `docker pull …` command instead of the manifest URL", () => {
    const manifestUrl =
      "https://flyjfrog.jfrog.io/v2/docker-public/myorg/my-image/manifests/1.0.0";
    const results: DistributeResponse[] = [
      {
        package_name: "myorg/my-image",
        package_version: "1.0.0",
        package_type: "docker",
        public_url: "https://flyjfrog.jfrog.io/v2/docker-public/myorg/my-image",
        download_url: manifestUrl,
        download_count: 0,
      },
    ];

    const table = buildDistributedTable(results);
    // Inline-code pull command derived from public_url + version. Backticks
    // signal "command, not URL" in the rendered markdown table.
    expect(table).toContain(
      "`docker pull flyjfrog.jfrog.io/docker-public/myorg/my-image:1.0.0`",
    );
    // Manifest URL must not leak into the cell — clicking it returns JSON.
    expect(table).not.toContain(`[${manifestUrl}](${manifestUrl})`);
  });

  it("mixes generic and docker rows: each renders its own cell shape", () => {
    const genericDownload =
      "https://fly.example.com/public/generic/tenant/my-app/1.0.0/my-app.tar.gz";
    const results: DistributeResponse[] = [
      {
        package_name: "my-app",
        package_version: "1.0.0",
        package_type: "generic",
        public_url:
          "https://fly.example.com/public/generic/tenant/my-app/1.0.0",
        download_url: genericDownload,
        download_count: 0,
      },
      {
        package_name: "myorg/my-image",
        package_version: "2.0.0",
        package_type: "docker",
        public_url: "https://flyjfrog.jfrog.io/v2/docker-public/myorg/my-image",
        download_url:
          "https://flyjfrog.jfrog.io/v2/docker-public/myorg/my-image/manifests/2.0.0",
        download_count: 0,
      },
    ];

    const table = buildDistributedTable(results);
    expect(table).toContain(`[${genericDownload}](${genericDownload})`);
    expect(table).toContain(
      "`docker pull flyjfrog.jfrog.io/docker-public/myorg/my-image:2.0.0`",
    );
  });
});

describe("buildArtifactsTable", () => {
  it("returns empty string for no artifacts", () => {
    expect(buildArtifactsTable([])).toBe("");
  });

  it("resolves, deduplicates and renders artifacts", () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/v1.0.0/manifest.json",
      },
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/v1.0.0/manifest.json",
      },
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/sha256:abc123/manifest.json",
      },
    ];

    const table = buildArtifactsTable(artifacts);
    expect(table).toContain("| Type | Package | Version |");
    expect(table).toContain("| docker | myorg/api | v1.0.0 |");
    expect(table.match(/myorg\/api/g)).toHaveLength(1);
  });

  it("sorts artifacts by ecosystem", () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "manifest.json",
        type: "docker",
        path: "img/latest/manifest.json",
      },
      {
        name: "lib-1.0.0.tgz",
        type: "npm",
        path: "lib/-/lib-1.0.0.tgz",
      },
    ];

    const table = buildArtifactsTable(artifacts);
    const npmIdx = table.indexOf("npm");
    const dockerIdx = table.indexOf("docker");
    expect(npmIdx).toBeLessThan(dockerIdx);
  });

  it("renders size column when at least one artifact has size", () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "lib-1.0.0.tgz",
        type: "npm",
        path: "lib/-/lib-1.0.0.tgz",
        size: 1048576,
      },
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/v1.0.0/manifest.json",
      },
    ];

    const table = buildArtifactsTable(artifacts);
    expect(table).toContain("| Type | Package | Version | Size |");
    expect(table).toContain("| npm | lib | 1.0.0 | 1.0 MB |");
    expect(table).toContain("| docker | myorg/api | v1.0.0 |  |");
  });

  it("shows fallback message when all artifacts are filtered (digest-only)", () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/sha256:abc123/manifest.json",
      },
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/sha256:def456/manifest.json",
      },
    ];

    const table = buildArtifactsTable(artifacts);
    expect(table).toContain("No displayable artifacts");
    expect(table).not.toContain("Collected Artifacts");
  });

  it("omits size column when no artifact has size", () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "lib-1.0.0.tgz",
        type: "npm",
        path: "lib/-/lib-1.0.0.tgz",
      },
    ];

    const table = buildArtifactsTable(artifacts);
    expect(table).toContain("| Type | Package | Version |");
    expect(table).not.toContain("Size");
  });
});

describe("formatSize", () => {
  it("returns empty string for undefined", () => {
    expect(formatSize(undefined)).toBe("");
  });

  it("returns empty string for 0", () => {
    expect(formatSize(0)).toBe("");
  });

  it("formats bytes", () => {
    expect(formatSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatSize(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatSize(1048576)).toBe("1.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatSize(1073741824)).toBe("1.0 GB");
  });
});

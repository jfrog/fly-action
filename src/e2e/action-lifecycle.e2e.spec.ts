// Copyright (c) JFrog Ltd. (2025)

/**
 * End-to-end test for the full GitHub Action lifecycle.
 *
 * Simulates a complete job: main step (OIDC + CLI setup) → upload sub-action
 * → download sub-action → post step (CI end + job summary). Only external
 * boundaries are mocked (OIDC endpoint, fly CLI binary, Fly API). The full
 * TypeScript pipeline runs for real, verifying that data flows correctly
 * across steps via environment variables and state.
 */

import { vi } from "vitest";

// Shared mutable state that simulates the GitHub Actions runner.
// vi.hoisted ensures these are available inside vi.mock factories.
const {
  mockInputs,
  mockState,
  mockOutputs,
  mockSummary,
  mockSecrets,
  mockFailed,
} = vi.hoisted(() => ({
  mockInputs: { current: {} as Record<string, string> },
  mockState: {} as Record<string, string>,
  mockOutputs: {} as Record<string, string>,
  mockSummary: {
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined) as ReturnType<typeof vi.fn>,
  },
  mockSecrets: [] as string[],
  mockFailed: { message: undefined as string | undefined },
}));

// --- Mock @actions/core to behave like the real runner ---
vi.mock("@actions/core", () => ({
  getInput: vi.fn((name: string) => mockInputs.current[name] || ""),
  exportVariable: vi.fn((name: string, val: string) => {
    process.env[name] = String(val);
  }),
  setOutput: vi.fn((name: string, val: string) => {
    mockOutputs[name] = val;
  }),
  saveState: vi.fn((name: string, val: string) => {
    mockState[name] = val;
  }),
  getState: vi.fn((name: string) => mockState[name] || ""),
  setSecret: vi.fn((val: string) => mockSecrets.push(val)),
  setFailed: vi.fn((msg: string) => {
    mockFailed.message = msg;
  }),
  addPath: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  summary: mockSummary,
}));

// --- Mock @actions/exec to simulate fly CLI responses ---
vi.mock("@actions/exec", () => ({
  exec: vi.fn(
    async (
      _cmd: string,
      args?: string[],
      options?: {
        listeners?: {
          stdout?: (data: Buffer) => void;
          stderr?: (data: Buffer) => void;
        };
      },
    ) => {
      const subcommand = args?.[0] || "";
      let response;

      if (subcommand === "version") {
        response = {
          command: "version",
          results: [{ name: "fly", status: "success", message: "1.2.0" }],
        };
      } else if (subcommand === "setup") {
        response = {
          command: "setup",
          results: [
            { name: "npm", status: "configured" },
            { name: "pip", status: "configured" },
          ],
        };
      } else if (subcommand === "upload") {
        response = {
          command: "upload",
          results: [
            { name: "app.zip", status: "success" },
            { name: "app.tar.gz", status: "success" },
          ],
        };
      } else if (subcommand === "download") {
        response = {
          command: "download",
          results: [{ name: "docs.pdf", status: "success" }],
        };
      }

      if (response) {
        options?.listeners?.stdout?.(Buffer.from(JSON.stringify(response)));
      }
      return 0;
    },
  ),
}));

// --- Mock @actions/tool-cache for CLI download ---
vi.mock("@actions/tool-cache", () => ({
  downloadTool: vi.fn().mockResolvedValue("/tmp/fly-download"),
  cacheFile: vi.fn().mockResolvedValue("/cached/fly/1.2.0"),
  find: vi.fn().mockReturnValue(""),
}));

// --- Mock @actions/http-client so resolveLatestRedirect doesn't make real HTTP calls ---
vi.mock("@actions/http-client", async () => {
  const actual = await vi.importActual<typeof import("@actions/http-client")>(
    "@actions/http-client",
  );
  return {
    ...actual,
    HttpClient: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({
        message: {
          statusCode: 302,
          headers: {
            location: "/public/generic/fly-client/1.2.0/fly-linux-x64",
          },
        },
        readBody: vi.fn().mockResolvedValue(""),
      }),
      dispose: vi.fn(),
    })),
  };
});

// --- Mock OIDC auth ---
vi.mock("../oidc", () => ({
  authenticateOidc: vi.fn().mockResolvedValue({
    accessToken: "e2e-test-token",
    flyTenantUrl: "https://e2e-tenant.jfrog.io",
  }),
}));

// --- Mock HTTP client for post step ---
vi.mock("../utils", () => ({
  createHttpClient: vi.fn(() => ({
    post: vi.fn().mockResolvedValue({
      message: { statusCode: 200 },
      readBody: vi.fn().mockResolvedValue(
        JSON.stringify({
          artifacts: [
            { name: "npm-lib", type: "npm" },
            { name: "docker-app", type: "docker" },
          ],
        }),
      ),
    }),
    dispose: vi.fn(),
  })),
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  truncate: (s: string) => s,
}));

// --- Keep fs.readFileSync real (for job summary template) but mock chmodSync ---
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, chmodSync: vi.fn() };
});

import { run } from "../index";
import { runUpload } from "../upload";
import { runDownload } from "../download";
import { runPost } from "../post";
import * as core from "@actions/core";
import { authenticateOidc } from "../oidc";
import {
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
  ENV_FLY_ACTION_CONFIGURED,
  ENV_FLY_REGISTRY_SUBDOMAIN,
  ENV_FLY_TRANSFER_RESULTS,
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PLATFORM_URL,
} from "../constants";

const ENV_VARS_TO_CLEAN = [
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
  ENV_FLY_ACTION_CONFIGURED,
  ENV_FLY_REGISTRY_SUBDOMAIN,
  ENV_FLY_TRANSFER_RESULTS,
  "FLY_IGNORE_PACKAGE_MANAGERS",
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_OWNER",
  "GITHUB_WORKFLOW",
  "GITHUB_RUN_NUMBER",
  "GITHUB_SERVER_URL",
  "CUSTOM_FLY_URL",
];

describe("Action lifecycle e2e", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    for (const key of ENV_VARS_TO_CLEAN) {
      delete process.env[key];
    }
    for (const key of Object.keys(mockState)) delete mockState[key];
    for (const key of Object.keys(mockOutputs)) delete mockOutputs[key];
    mockInputs.current = {};
    mockSecrets.length = 0;
    mockFailed.message = undefined;
    mockSummary.write.mockResolvedValue(undefined);

    process.env.GITHUB_REPOSITORY = "my-org/my-repo";
    process.env.GITHUB_REPOSITORY_OWNER = "my-org";
    process.env.GITHUB_WORKFLOW = "CI Build";
    process.env.GITHUB_RUN_NUMBER = "42";
  });

  afterEach(() => {
    for (const key of ENV_VARS_TO_CLEAN) {
      delete process.env[key];
    }
  });

  it("full lifecycle: setup → upload → download → post with job summary", async () => {
    // ========== Step 1: Main action (OIDC auth + CLI setup) ==========
    mockInputs.current = { url: "", ignore: "" };

    await run();

    // OIDC auth was called
    expect(authenticateOidc).toHaveBeenCalledWith("https://fly.jfrog.ai");

    // Credentials exported to env for sub-actions
    expect(process.env[ENV_FLY_URL_RUNTIME]).toBe(
      "https://e2e-tenant.jfrog.io",
    );
    expect(process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME]).toBe("e2e-test-token");

    // Registry subdomain exported (hostname without protocol)
    expect(process.env[ENV_FLY_REGISTRY_SUBDOMAIN]).toBe("e2e-tenant.jfrog.io");

    // Idempotency flag set
    expect(process.env[ENV_FLY_ACTION_CONFIGURED]).toBe("true");

    // State saved for post step
    expect(mockState[STATE_FLY_URL]).toBe("https://e2e-tenant.jfrog.io");
    expect(mockState[STATE_FLY_ACCESS_TOKEN]).toBe("e2e-test-token");
    expect(mockState[STATE_FLY_PLATFORM_URL]).toBe("https://fly.jfrog.ai");

    // Access token was masked
    expect(mockSecrets).toContain("e2e-test-token");

    // No failures
    expect(mockFailed.message).toBeUndefined();

    // ========== Step 2: Upload sub-action ==========
    mockInputs.current = {
      name: "my-app",
      version: "1.0.0",
      files: "dist/app.zip\ndist/app.tar.gz",
      exclude: "*.log",
    };

    await runUpload();

    // Upload results set as output
    expect(mockOutputs["results"]).toBeDefined();
    const uploadResults = JSON.parse(mockOutputs["results"]);
    expect(uploadResults).toHaveLength(2);
    expect(uploadResults[0].name).toBe("app.zip");

    // Transfer results accumulated in env
    expect(process.env[ENV_FLY_TRANSFER_RESULTS]).toBeDefined();
    const afterUpload = process.env[ENV_FLY_TRANSFER_RESULTS]!;
    const uploadEntry = JSON.parse(afterUpload);
    expect(uploadEntry.type).toBe("upload");
    expect(uploadEntry.name).toBe("my-app");
    expect(uploadEntry.version).toBe("1.0.0");
    expect(uploadEntry.results).toHaveLength(2);

    expect(mockFailed.message).toBeUndefined();

    // ========== Step 3: Download sub-action ==========
    mockInputs.current = {
      name: "my-app",
      version: "1.0.0",
      files: "docs.pdf",
      "output-dir": "./out",
      exclude: "",
    };

    await runDownload();

    // Download results set as output
    expect(mockOutputs["results"]).toBeDefined();
    const downloadResults = JSON.parse(mockOutputs["results"]);
    expect(downloadResults).toHaveLength(1);
    expect(downloadResults[0].name).toBe("docs.pdf");

    // Both entries accumulated (upload + download)
    const transferLines = process.env[ENV_FLY_TRANSFER_RESULTS]!.split("\n");
    expect(transferLines).toHaveLength(2);

    const entry1 = JSON.parse(transferLines[0]);
    const entry2 = JSON.parse(transferLines[1]);
    expect(entry1.type).toBe("upload");
    expect(entry2.type).toBe("download");
    expect(entry2.results[0].name).toBe("docs.pdf");

    expect(mockFailed.message).toBeUndefined();

    // ========== Step 4: Post step (CI end + job summary) ==========
    await runPost();

    // Job summary was written
    expect(mockSummary.addRaw).toHaveBeenCalled();
    expect(mockSummary.write).toHaveBeenCalled();

    const summaryMarkdown = vi.mocked(mockSummary.addRaw).mock
      .calls[0][0] as string;

    // Summary contains the job name header from GITHUB_JOB (or fallback)
    const expectedJobName = process.env.GITHUB_JOB || "CI Job";
    expect(summaryMarkdown).toContain(`## ${expectedJobName}`);

    // Summary contains artifacts from ci/end response
    expect(summaryMarkdown).toContain("Collected Artifacts");
    expect(summaryMarkdown).toContain("npm-lib");
    expect(summaryMarkdown).toContain("docker-app");

    // Summary contains transfer results from upload + download
    expect(summaryMarkdown).toContain("Uploads & Downloads");
    expect(summaryMarkdown).toContain("upload");
    expect(summaryMarkdown).toContain("download");
    expect(summaryMarkdown).toContain("my-app");
    expect(summaryMarkdown).toContain("1.0.0");
    expect(summaryMarkdown).toContain("app.zip");
    expect(summaryMarkdown).toContain("app.tar.gz");
    expect(summaryMarkdown).toContain("docs.pdf");

    // Summary contains release URL with correct repo/workflow/run
    expect(summaryMarkdown).toContain("my-org/my-repo");
    expect(summaryMarkdown).toContain("CI%20Build");
    expect(summaryMarkdown).toContain("/42/");

    // No failures throughout the entire lifecycle
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("idempotency: main action skips duplicate run", async () => {
    mockInputs.current = { url: "", ignore: "" };

    await run();
    expect(authenticateOidc).toHaveBeenCalledTimes(1);

    // Second run should be skipped
    await run();
    expect(authenticateOidc).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining("already been configured"),
    );
  });

  it("upload errors are reported but results still accumulate", async () => {
    // Set up auth env (simulating what main step does)
    process.env[ENV_FLY_URL_RUNTIME] = "https://e2e-tenant.jfrog.io";
    process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME] = "e2e-test-token";

    // Override exec to return an error result for upload
    const { exec } = await import("@actions/exec");
    vi.mocked(exec).mockImplementationOnce(async (_cmd, args, options) => {
      const response = {
        command: "upload",
        results: [
          { name: "good.zip", status: "success" },
          {
            name: "bad.zip",
            status: "error",
            message: "checksum mismatch",
          },
        ],
      };
      (
        options as {
          listeners?: { stdout?: (data: Buffer) => void };
        }
      )?.listeners?.stdout?.(Buffer.from(JSON.stringify(response)));
      return 1;
    });

    mockInputs.current = {
      name: "my-app",
      version: "2.0.0",
      files: "good.zip\nbad.zip",
      exclude: "",
    };

    await runUpload();

    // Error was reported
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Upload failed for 1 file(s)"),
    );

    // But results still accumulated for the job summary
    expect(process.env[ENV_FLY_TRANSFER_RESULTS]).toBeDefined();
    const entry = JSON.parse(process.env[ENV_FLY_TRANSFER_RESULTS]!);
    expect(entry.results).toHaveLength(2);
    expect(entry.results[1].status).toBe("error");
  });
});

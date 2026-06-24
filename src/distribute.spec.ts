// Copyright (c) JFrog Ltd. (2025)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setSecret: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  exportVariable: vi.fn(),
}));

const mockPost = vi.fn();
const mockDispose = vi.fn();

vi.mock("./utils", () => ({
  createHttpClient: () => ({
    post: mockPost,
    dispose: mockDispose,
  }),
  truncate: (s: string) => s,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import * as core from "@actions/core";
import { runDistribute } from "./distribute";
import {
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
  ENV_FLY_DISTRIBUTE_RESULTS,
} from "./constants";
import type { DistributeResponse, DistributeSummaryEntry } from "./types";

const MOCK_RESPONSE: DistributeResponse = {
  package_name: "my-app",
  package_version: "1.0.0",
  package_type: "generic",
  public_url: "https://fly.example.com/public/generic/tenant/my-app/1.0.0",
  download_url:
    "https://fly.example.com/public/generic/tenant/my-app/1.0.0/my-app.tar.gz",
  download_count: 0,
};

// Slim projection persisted to FLY_DISTRIBUTE_RESULTS — only the fields the job
// summary renders, with the unbounded `files[]`/`download_count` dropped to
// bound the env-var size (issue #69).
function summaryOf(r: DistributeResponse): DistributeSummaryEntry {
  return {
    package_name: r.package_name,
    package_version: r.package_version,
    package_type: r.package_type,
    public_url: r.public_url,
    download_url: r.download_url,
  };
}

function mockInputs(inputs: Record<string, string>): void {
  vi.mocked(core.getInput).mockImplementation(
    (name: string) => inputs[name] ?? "",
  );
}

describe("runDistribute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockReset();
    mockDispose.mockReset();

    process.env[ENV_FLY_URL_RUNTIME] = "https://fly.example.com";
    process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME] = "test-token";
    delete process.env[ENV_FLY_DISTRIBUTE_RESULTS];
  });

  afterEach(() => {
    delete process.env[ENV_FLY_URL_RUNTIME];
    delete process.env[ENV_FLY_ACCESS_TOKEN_RUNTIME];
    delete process.env[ENV_FLY_DISTRIBUTE_RESULTS];
  });

  it("distributes a single artifact and emits a 1-element results array", async () => {
    mockInputs({ name: "my-app", version: "1.0.0", type: "generic" });

    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(MOCK_RESPONSE)),
    });

    await runDistribute();

    expect(core.setFailed).not.toHaveBeenCalled();
    // Step output keeps the full response (not subject to the env-var limit).
    expect(core.setOutput).toHaveBeenCalledWith(
      "results",
      JSON.stringify([MOCK_RESPONSE]),
    );
    // Env var persists only the slim summary projection.
    expect(core.exportVariable).toHaveBeenCalledWith(
      ENV_FLY_DISTRIBUTE_RESULTS,
      JSON.stringify([summaryOf(MOCK_RESPONSE)]),
    );
    expect(mockDispose).toHaveBeenCalled();
  });

  it("fails when auth is not configured", async () => {
    delete process.env[ENV_FLY_URL_RUNTIME];
    mockInputs({ name: "my-app", version: "1.0.0" });

    await runDistribute();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("FLY_URL"),
    );
  });

  it("fails when API returns non-200", async () => {
    mockInputs({ name: "my-app", version: "1.0.0", type: "generic" });

    mockPost.mockResolvedValue({
      message: { statusCode: 404 },
      readBody: () => Promise.resolve("not found"),
    });

    await runDistribute();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Failed to distribute"),
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it("defaults package type to generic when the input is empty", async () => {
    mockInputs({ name: "my-app", version: "1.0.0" });

    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(MOCK_RESPONSE)),
    });

    await runDistribute();

    const body = JSON.parse(mockPost.mock.calls[0][1]);
    expect(body.package_type).toBe("generic");
  });

  it("distributes a docker image and logs the pull command", async () => {
    mockInputs({ name: "myorg/my-image", version: "1.0.0", type: "docker" });

    const dockerResponse: DistributeResponse = {
      package_name: "myorg/my-image",
      package_version: "1.0.0",
      package_type: "docker",
      public_url: "https://flyjfrog.jfrog.io/v2/docker-public/myorg/my-image",
      download_url:
        "https://flyjfrog.jfrog.io/v2/docker-public/myorg/my-image/manifests/1.0.0",
      download_count: 0,
      files: [
        {
          package_name: "myorg/my-image",
          package_version: "1.0.0",
          file_name: "manifest.json",
          sha256: "abcd",
          download_count: 0,
        },
      ],
    };

    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(dockerResponse)),
    });

    await runDistribute();

    expect(core.setFailed).not.toHaveBeenCalled();
    // Payload carries package_type=docker through to the backend unchanged.
    const body = JSON.parse(mockPost.mock.calls[0][1]);
    expect(body.package_type).toBe("docker");
    // Pull command is derived from public_url + version, with `/v2/` stripped
    // so consumers can paste it into a shell.
    expect(core.info).toHaveBeenCalledWith(
      "   Pull:       docker pull flyjfrog.jfrog.io/docker-public/myorg/my-image:1.0.0",
    );
    // Regression for issue #69: the unbounded `files[]` breakdown must NOT be
    // persisted to the env var, otherwise FLY_DISTRIBUTE_RESULTS grows past the
    // 128 KB single-env-var limit and breaks every later step.
    const exported = vi
      .mocked(core.exportVariable)
      .mock.calls.find((c) => c[0] === ENV_FLY_DISTRIBUTE_RESULTS);
    expect(exported).toBeDefined();
    expect(exported![1]).not.toContain("files");
    expect(exported![1]).not.toContain("manifest.json");
    expect(exported![1]).toBe(JSON.stringify([summaryOf(dockerResponse)]));
  });

  it("does not log a pull command for non-docker distributions", async () => {
    mockInputs({ name: "my-app", version: "1.0.0", type: "generic" });

    mockPost.mockResolvedValue({
      message: { statusCode: 200 },
      readBody: () => Promise.resolve(JSON.stringify(MOCK_RESPONSE)),
    });

    await runDistribute();

    const infoCalls = vi.mocked(core.info).mock.calls.map((c) => c[0]);
    expect(infoCalls.some((line) => line.includes("Pull:"))).toBe(false);
  });

  it("accumulates results across multiple runDistribute invocations", async () => {
    const response2: DistributeResponse = {
      ...MOCK_RESPONSE,
      package_name: "my-lib",
      package_version: "2.3.1",
    };

    let currentInputs: Record<string, string> = {
      name: "my-app",
      version: "1.0.0",
      type: "generic",
    };
    vi.mocked(core.getInput).mockImplementation(
      (n: string) => currentInputs[n] ?? "",
    );

    mockPost
      .mockResolvedValueOnce({
        message: { statusCode: 200 },
        readBody: () => Promise.resolve(JSON.stringify(MOCK_RESPONSE)),
      })
      .mockResolvedValueOnce({
        message: { statusCode: 200 },
        readBody: () => Promise.resolve(JSON.stringify(response2)),
      });

    // First invocation — env var empty, exportVariable gets a single JSON array.
    // Simulate GitHub Actions propagating the exported var to the next step by
    // copying the exportVariable arg into process.env.
    await runDistribute();
    const firstExport = vi.mocked(core.exportVariable).mock
      .calls[0] as unknown as [string, string];
    expect(firstExport[0]).toBe(ENV_FLY_DISTRIBUTE_RESULTS);
    expect(firstExport[1]).toBe(JSON.stringify([summaryOf(MOCK_RESPONSE)]));
    process.env[ENV_FLY_DISTRIBUTE_RESULTS] = firstExport[1];

    // Second invocation — env var already has the first line; appendDistributeResults
    // should produce "<existing>\n<new>" so the post step can parse both.
    currentInputs = { name: "my-lib", version: "2.3.1", type: "generic" };
    await runDistribute();
    const secondExport = vi.mocked(core.exportVariable).mock
      .calls[1] as unknown as [string, string];
    expect(secondExport[0]).toBe(ENV_FLY_DISTRIBUTE_RESULTS);
    const expected = `${JSON.stringify([summaryOf(MOCK_RESPONSE)])}\n${JSON.stringify([summaryOf(response2)])}`;
    expect(secondExport[1]).toBe(expected);

    // Verify the post-step parser (same logic used by createJobSummary) handles
    // the accumulated newline-separated JSON arrays.
    const parsed: DistributeSummaryEntry[] = secondExport[1]
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => JSON.parse(line) as DistributeSummaryEntry[]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].package_name).toBe("my-app");
    expect(parsed[1].package_name).toBe("my-lib");
  });
});

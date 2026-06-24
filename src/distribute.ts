// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { getAuthEnv } from "./fly-cli";
import { distributeArtifact } from "./distribute-core";
import {
  INPUT_NAME,
  INPUT_VERSION,
  INPUT_DISTRIBUTE_TYPE,
  OUTPUT_RESULTS,
  ENV_FLY_DISTRIBUTE_RESULTS,
} from "./constants";
import { getErrorMessage } from "./utils";
import { DistributeResponse, DistributeSummaryEntry } from "./types";

export async function runDistribute(): Promise<void> {
  try {
    const name = core.getInput(INPUT_NAME, { required: true });
    const version = core.getInput(INPUT_VERSION, { required: true });
    // NOTE: `type` is forwarded to fly-service without a client-side allowlist
    // check on purpose — the backend is the single source of truth for which
    // package types are publicly distributable and returns a typed 400 for
    // unsupported values. Keeping the allowlist server-side prevents the
    // action and fly-service from drifting (e.g. when Phase 3 wires helm).
    const packageType = core.getInput(INPUT_DISTRIBUTE_TYPE) || "generic";

    const { url, token } = getAuthEnv();
    core.setSecret(token);

    const result = await distributeArtifact(
      url,
      token,
      name,
      version,
      packageType,
    );

    // `results` is emitted as a 1-element array so the output shape stays
    // consistent with upload/download and the post step can accumulate
    // results across multiple distribute invocations without branching on
    // per-step cardinality.
    const results: DistributeResponse[] = [result];
    core.setOutput(OUTPUT_RESULTS, JSON.stringify(results));
    appendDistributeResults(results);

    core.info(`✅ Successfully distributed ${name}:${version}.`);
  } catch (error) {
    core.setFailed(getErrorMessage(error));
  }
}

/** Slim projection for the env var — see {@link DistributeSummaryEntry} / #69. */
export function toSummaryEntry(r: DistributeResponse): DistributeSummaryEntry {
  return {
    package_name: r.package_name,
    package_version: r.package_version,
    package_type: r.package_type,
    public_url: r.public_url,
    download_url: r.download_url,
  };
}

/**
 * Appends the slim distribute results to FLY_DISTRIBUTE_RESULTS as a JSON line;
 * the post step reads all accumulated lines for the job-summary table. The full
 * response is still exposed verbatim via the step `results` output.
 */
function appendDistributeResults(results: DistributeResponse[]): void {
  const line = JSON.stringify(results.map(toSummaryEntry));
  const existing = process.env[ENV_FLY_DISTRIBUTE_RESULTS] || "";
  const updated = existing ? `${existing}\n${line}` : line;
  core.exportVariable(ENV_FLY_DISTRIBUTE_RESULTS, updated);
}

if (require.main === module) {
  runDistribute();
}

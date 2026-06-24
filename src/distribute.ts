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

/**
 * Projects a distribute response down to only the fields the job-summary table
 * renders. Dropping the unbounded `files[]` breakdown keeps the persisted env
 * var small — see {@link DistributeSummaryEntry} and issue #69.
 */
function toSummaryEntry(r: DistributeResponse): DistributeSummaryEntry {
  return {
    package_name: r.package_name,
    package_version: r.package_version,
    package_type: r.package_type,
    public_url: r.public_url,
    download_url: r.download_url,
  };
}

/**
 * Appends distribute results to the FLY_DISTRIBUTE_RESULTS env var as a
 * JSON line. The post step reads all accumulated lines to render the
 * distributed artifacts table in the job summary.
 *
 * Only the summary-relevant fields are persisted (via {@link toSummaryEntry}).
 * The full response — including the unbounded per-file `files[]` array — is
 * still exposed verbatim via the step `results` output, which is not subject to
 * the env-var size limit that broke later steps in issue #69.
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

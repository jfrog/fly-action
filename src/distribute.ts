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
import { DistributeResponse } from "./types";

export async function runDistribute(): Promise<void> {
  try {
    const name = core.getInput(INPUT_NAME, { required: true });
    const version = core.getInput(INPUT_VERSION, { required: true });
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
 * Appends distribute results to the FLY_DISTRIBUTE_RESULTS env var as a
 * JSON line. The post step reads all accumulated lines to render the
 * distributed artifacts table in the job summary.
 */
function appendDistributeResults(results: DistributeResponse[]): void {
  const line = JSON.stringify(results);
  const existing = process.env[ENV_FLY_DISTRIBUTE_RESULTS] || "";
  const updated = existing ? `${existing}\n${line}` : line;
  core.exportVariable(ENV_FLY_DISTRIBUTE_RESULTS, updated);
}

if (require.main === module) {
  runDistribute();
}

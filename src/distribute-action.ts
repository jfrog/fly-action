// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { getAuthEnv } from "./fly-cli";
import { parseDistributeInput, distributeArtifacts } from "./distribute";
import {
  INPUT_DISTRIBUTE_ARTIFACTS,
  INPUT_DISTRIBUTE_TYPE,
  OUTPUT_RESULTS,
  ENV_FLY_DISTRIBUTE_RESULTS,
} from "./constants";
import { getErrorMessage } from "./utils";
import { DistributeResponse } from "./types";

export async function runDistribute(): Promise<void> {
  try {
    const artifactsInput = core.getInput(INPUT_DISTRIBUTE_ARTIFACTS, {
      required: true,
    });
    const packageType = core.getInput(INPUT_DISTRIBUTE_TYPE) || "generic";

    const { url, token } = getAuthEnv();
    core.setSecret(token);

    const entries = parseDistributeInput(artifactsInput, packageType);
    if (entries.length === 0) {
      throw new Error(
        'No artifacts to distribute. Provide at least one "name:version" pair.',
      );
    }

    core.info(`Distributing ${entries.length} artifact(s) publicly...`);
    const results = await distributeArtifacts(url, token, entries);

    const resultsJson = JSON.stringify(results);
    core.setOutput(OUTPUT_RESULTS, resultsJson);
    appendDistributeResults(results);

    core.info(
      `✅ Successfully distributed ${results.length} artifact(s).`,
    );
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

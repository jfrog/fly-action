// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { getAuthEnv } from "./fly-cli";
import { parseDistributeInput, distributeArtifacts } from "./distribute-core";
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
    const { successes, failures } = await distributeArtifacts(
      url,
      token,
      entries,
    );

    // Always emit partial results before failing. Artifacts in `successes` were
    // actually made public server-side; downstream steps and the job summary
    // need to see them even when other entries failed.
    core.setOutput(OUTPUT_RESULTS, JSON.stringify(successes));
    appendDistributeResults(successes);

    if (failures.length > 0) {
      const failedList = failures
        .map((f) => `${f.entry.name}:${f.entry.version} (${f.error})`)
        .join("; ");
      throw new Error(
        `Failed to distribute ${failures.length} of ${entries.length} artifact(s): ${failedList}`,
      );
    }

    core.info(`✅ Successfully distributed ${successes.length} artifact(s).`);
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

// Copyright (c) JFrog Ltd. (2026)

import * as core from "@actions/core";
import { execFlyCLI, getAuthEnv } from "./fly-cli";
import { appendTransferResults } from "./transfer";
import { getErrorMessage } from "./utils";
import {
  CLI_CMD_PUBLISH,
  CLI_FLAG_VERSION,
  INPUT_PATH,
  INPUT_VERSION,
  OUTPUT_RESULTS,
  STATUS_ERROR,
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
} from "./constants";

export async function runGoPublish(): Promise<void> {
  try {
    const modulePath = core.getInput(INPUT_PATH) || ".";
    const version = core.getInput(INPUT_VERSION);

    const { url, token } = getAuthEnv();
    core.setSecret(token);

    const args = [CLI_CMD_PUBLISH, "go", modulePath];
    if (version) {
      args.push(CLI_FLAG_VERSION, version);
    }

    const response = await execFlyCLI(args, {
      [ENV_FLY_URL_RUNTIME]: url,
      [ENV_FLY_ACCESS_TOKEN_RUNTIME]: token,
    });

    core.setOutput(OUTPUT_RESULTS, JSON.stringify(response.results));
    appendTransferResults(
      "upload",
      modulePath,
      version || "auto",
      response.results,
    );

    const errors = response.results.filter((r) => r.status === STATUS_ERROR);
    if (errors.length > 0) {
      const summary = errors.map((e) => `${e.name}: ${e.message}`).join("\n");
      core.setFailed(`Go publish failed:\n${summary}`);
    } else {
      for (const result of response.results) {
        core.info(`Go publish: ${result.name} — ${result.message}`);
      }
    }
  } catch (error) {
    core.setFailed(getErrorMessage(error));
  }
}

if (require.main === module) {
  runGoPublish();
}

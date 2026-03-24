// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { execFlyCLI, getAuthEnv, parseMultilineInput } from "./fly-cli";
import {
  INPUT_NAME,
  INPUT_VERSION,
  INPUT_FILES,
  INPUT_EXCLUDE,
  INPUT_OUTPUT_DIR,
  OUTPUT_RESULTS,
  CLI_CMD_DOWNLOAD,
  CLI_FLAG_NAME,
  CLI_FLAG_VERSION,
  CLI_FLAG_EXCLUDE,
  CLI_FLAG_OUTPUT_DIR,
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
  STATUS_ERROR,
  DEFAULT_OUTPUT_DIR,
} from "./constants";

export async function runDownload(): Promise<void> {
  try {
    const name = core.getInput(INPUT_NAME, { required: true });
    const version = core.getInput(INPUT_VERSION, { required: true });
    const filesInput = core.getInput(INPUT_FILES, { required: true });
    const outputDir = core.getInput(INPUT_OUTPUT_DIR) || DEFAULT_OUTPUT_DIR;
    const excludeInput = core.getInput(INPUT_EXCLUDE);

    const { url, token } = getAuthEnv();
    core.setSecret(token);

    const files = parseMultilineInput(filesInput);
    if (files.length === 0) {
      throw new Error(
        "No files specified. Provide at least one remote filename.",
      );
    }

    const args = [
      CLI_CMD_DOWNLOAD,
      CLI_FLAG_NAME,
      name,
      CLI_FLAG_VERSION,
      version,
      CLI_FLAG_OUTPUT_DIR,
      outputDir,
    ];

    const excludes = parseMultilineInput(excludeInput);
    for (const pattern of excludes) {
      args.push(CLI_FLAG_EXCLUDE, pattern);
    }

    args.push(...files);

    const response = await execFlyCLI(args, {
      [ENV_FLY_URL_RUNTIME]: url,
      [ENV_FLY_ACCESS_TOKEN_RUNTIME]: token,
    });

    core.setOutput(OUTPUT_RESULTS, JSON.stringify(response.results));

    const errors = response.results.filter((r) => r.status === STATUS_ERROR);
    if (errors.length > 0) {
      const summary = errors.map((e) => `${e.name}: ${e.message}`).join("\n");
      core.setFailed(
        `Download failed for ${errors.length} file(s):\n${summary}`,
      );
    } else {
      core.info(
        `Successfully downloaded ${response.results.length} file(s) from ${name}@${version}`,
      );
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed("An unknown error occurred during download");
  }
}

if (require.main === module) {
  runDownload();
}

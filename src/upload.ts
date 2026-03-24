// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { execFlyCLI, getAuthEnv, parseMultilineInput } from "./fly-cli";
import {
  INPUT_NAME,
  INPUT_VERSION,
  INPUT_FILES,
  INPUT_EXCLUDE,
  OUTPUT_RESULTS,
  CLI_CMD_UPLOAD,
  CLI_FLAG_NAME,
  CLI_FLAG_VERSION,
  CLI_FLAG_URL,
  CLI_FLAG_ACCESS_TOKEN,
  CLI_FLAG_EXCLUDE,
  STATUS_ERROR,
} from "./constants";

export async function runUpload(): Promise<void> {
  try {
    const name = core.getInput(INPUT_NAME, { required: true });
    const version = core.getInput(INPUT_VERSION, { required: true });
    const filesInput = core.getInput(INPUT_FILES, { required: true });
    const excludeInput = core.getInput(INPUT_EXCLUDE);

    const { url, token } = getAuthEnv();

    const files = parseMultilineInput(filesInput);
    if (files.length === 0) {
      throw new Error(
        "No files specified. Provide at least one file path or glob pattern.",
      );
    }

    const args = [
      CLI_CMD_UPLOAD,
      CLI_FLAG_NAME,
      name,
      CLI_FLAG_VERSION,
      version,
      CLI_FLAG_URL,
      url,
      CLI_FLAG_ACCESS_TOKEN,
      token,
    ];

    const excludes = parseMultilineInput(excludeInput);
    for (const pattern of excludes) {
      args.push(CLI_FLAG_EXCLUDE, pattern);
    }

    args.push(...files);

    const response = await execFlyCLI(args);

    core.setOutput(OUTPUT_RESULTS, JSON.stringify(response.results));

    const errors = response.results.filter((r) => r.status === STATUS_ERROR);
    if (errors.length > 0) {
      const summary = errors.map((e) => `${e.name}: ${e.message}`).join("\n");
      core.setFailed(`Upload failed for ${errors.length} file(s):\n${summary}`);
    } else {
      core.info(
        `Successfully uploaded ${response.results.length} file(s) to ${name}@${version}`,
      );
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed("An unknown error occurred during upload");
  }
}

if (require.main === module) {
  runUpload();
}

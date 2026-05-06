// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { runTransfer } from "./transfer";
import { getErrorMessage } from "./utils";
import {
  CLI_CMD_UPLOAD,
  CLI_FLAG_IF_NO_FILES_FOUND,
  IF_NO_FILES_FOUND_VALUES,
  INPUT_IF_NO_FILES_FOUND,
} from "./constants";

export async function runUpload(): Promise<void> {
  let extraArgs: string[];
  try {
    extraArgs = buildUploadExtraArgs();
  } catch (error) {
    // buildUploadExtraArgs validates the if-no-files-found input. A bad value
    // is a workflow-config error and must surface as a clean step failure
    // rather than an unhandled rejection.
    core.setFailed(getErrorMessage(error));
    return;
  }
  await runTransfer({
    type: "upload",
    command: CLI_CMD_UPLOAD,
    extraArgs,
    noFilesMessage:
      "No files specified. Provide at least one file path or glob pattern.",
  });
}

/**
 * Builds upload-specific CLI args from action inputs. Currently only the
 * optional `if-no-files-found` input. Validated against the same whitelist
 * the Fly CLI accepts so users get a clean GitHub Actions error instead of
 * a CLI parse error mid-execution.
 */
export function buildUploadExtraArgs(): string[] {
  const ifNoFilesFound = core.getInput(INPUT_IF_NO_FILES_FOUND).trim();
  if (ifNoFilesFound.length === 0) {
    return [];
  }
  if (
    !(IF_NO_FILES_FOUND_VALUES as readonly string[]).includes(ifNoFilesFound)
  ) {
    throw new Error(
      `Invalid value for \`if-no-files-found\`: ${JSON.stringify(ifNoFilesFound)}. ` +
        `Must be one of: ${IF_NO_FILES_FOUND_VALUES.map((v) => `"${v}"`).join(", ")}.`,
    );
  }
  return [CLI_FLAG_IF_NO_FILES_FOUND, ifNoFilesFound];
}

if (require.main === module) {
  runUpload();
}

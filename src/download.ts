// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { runTransfer } from "./transfer";
import {
  CLI_CMD_DOWNLOAD,
  CLI_FLAG_OUTPUT_DIR,
  INPUT_OUTPUT_DIR,
  DEFAULT_OUTPUT_DIR,
} from "./constants";

export async function runDownload(): Promise<void> {
  const outputDir = core.getInput(INPUT_OUTPUT_DIR) || DEFAULT_OUTPUT_DIR;
  await runTransfer({
    type: "download",
    command: CLI_CMD_DOWNLOAD,
    extraArgs: [CLI_FLAG_OUTPUT_DIR, outputDir],
    // Used by the [LATEST] public-URL fetch path inside runTransfer, which
    // bypasses the fly CLI and writes files itself.
    outputDir,
    noFilesMessage: "No files specified. Provide at least one remote filename.",
  });
}

if (require.main === module) {
  runDownload();
}

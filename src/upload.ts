// Copyright (c) JFrog Ltd. (2025)

import { runTransfer } from "./transfer";
import { CLI_CMD_UPLOAD } from "./constants";

export async function runUpload(): Promise<void> {
  await runTransfer({
    type: "upload",
    command: CLI_CMD_UPLOAD,
    extraArgs: [],
    noFilesMessage:
      "No files specified. Provide at least one file path or glob pattern.",
  });
}

if (require.main === module) {
  runUpload();
}

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

    // Flags must precede MODULE_DIR: urfave/cli v2 stops parsing flags after
    // the first positional arg, silently dropping --version.
    const args = [CLI_CMD_PUBLISH, "go"];
    if (version) {
      args.push(CLI_FLAG_VERSION, version);
    }
    args.push(modulePath);

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

      // Surface actionable hints *before* core.setFailed so they stay visible
      // even if the red failure summary gets truncated in the GitHub UI. The
      // markers come from the CLI's error messages; an older CLI without
      // these hints will simply not match and we'll degrade to the raw
      // failure summary.
      const allMsgs = errors.map((e) => e.message).join("\n");
      if (allMsgs.includes("not a git repository")) {
        core.notice(
          "Hint: `fly publish go` requires the module directory to be a git " +
            "repository. If you generate sources at build time, run `git init`, " +
            "`git add -A`, and `git commit -m init` before invoking go-publish.",
        );
      }
      if (
        allMsgs.includes("dubious ownership") ||
        allMsgs.includes("safe.directory")
      ) {
        core.notice(
          "Hint: git refuses to read this directory due to ownership mismatch " +
            "(common in CI containers where the workspace is bind-mounted). " +
            "Run `git config --system --add safe.directory '*'` before invoking go-publish.",
        );
      }

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

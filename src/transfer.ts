// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { execFlyCLI, getAuthEnv, parseMultilineInput } from "./fly-cli";
import {
  INPUT_NAME,
  INPUT_VERSION,
  INPUT_FILES,
  INPUT_EXCLUDE,
  OUTPUT_RESULTS,
  CLI_FLAG_NAME,
  CLI_FLAG_VERSION,
  CLI_FLAG_EXCLUDE,
  ENV_FLY_URL_RUNTIME,
  ENV_FLY_ACCESS_TOKEN_RUNTIME,
  ENV_FLY_TRANSFER_RESULTS,
  STATUS_ERROR,
} from "./constants";
import { FlyClientResult, TransferSummaryEntry } from "./types";

export interface TransferConfig {
  type: "upload" | "download";
  command: string;
  extraArgs: string[];
  noFilesMessage: string;
}

/**
 * Shared orchestration for upload and download sub-actions.
 * Reads common inputs, authenticates, builds CLI args, executes
 * the fly CLI, records results for the job summary, and reports errors.
 */
export async function runTransfer(config: TransferConfig): Promise<void> {
  try {
    const name = core.getInput(INPUT_NAME, { required: true });
    const version = core.getInput(INPUT_VERSION, { required: true });
    const filesInput = core.getInput(INPUT_FILES, { required: true });
    const excludeInput = core.getInput(INPUT_EXCLUDE);

    const { url, token } = getAuthEnv();
    core.setSecret(token);

    const files = parseMultilineInput(filesInput);
    if (files.length === 0) {
      throw new Error(config.noFilesMessage);
    }

    const args = [
      config.command,
      CLI_FLAG_NAME,
      name,
      CLI_FLAG_VERSION,
      version,
      ...config.extraArgs,
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
    appendTransferResults(config.type, name, version, response.results);

    const errors = response.results.filter((r) => r.status === STATUS_ERROR);
    if (errors.length > 0) {
      const summary = errors.map((e) => `${e.name}: ${e.message}`).join("\n");
      core.setFailed(
        `${capitalize(config.type)} failed for ${errors.length} file(s):\n${summary}`,
      );
    } else {
      core.info(
        `Successfully ${config.type === "upload" ? "uploaded" : "downloaded"} ${response.results.length} file(s) ${config.type === "upload" ? "to" : "from"} ${name}@${version}`,
      );
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
    else core.setFailed(`An unknown error occurred during ${config.type}`);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Appends an upload/download result entry to the FLY_TRANSFER_RESULTS env var
 * as a JSON line. The post step reads all accumulated lines to render the
 * job summary. Each call adds one line for one sub-action invocation.
 */
export function appendTransferResults(
  type: "upload" | "download",
  name: string,
  version: string,
  results: FlyClientResult[],
): void {
  const entry: TransferSummaryEntry = { type, name, version, results };
  const existing = process.env[ENV_FLY_TRANSFER_RESULTS] || "";
  const line = JSON.stringify(entry);
  const updated = existing ? `${existing}\n${line}` : line;
  core.exportVariable(ENV_FLY_TRANSFER_RESULTS, updated);
}

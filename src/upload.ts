// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { execFlyCLI, getAuthEnv, parseMultilineInput } from "./fly-cli";

export async function runUpload(): Promise<void> {
  try {
    const name = core.getInput("name", { required: true });
    const version = core.getInput("version", { required: true });
    const filesInput = core.getInput("files", { required: true });
    const excludeInput = core.getInput("exclude");

    const { url, token } = getAuthEnv();

    const files = parseMultilineInput(filesInput);
    if (files.length === 0) {
      throw new Error("No files specified. Provide at least one file path or glob pattern.");
    }

    const args = [
      "upload",
      "--name", name,
      "--version", version,
      "--url", url,
      "--access-token", token,
    ];

    const excludes = parseMultilineInput(excludeInput);
    for (const pattern of excludes) {
      args.push("--exclude", pattern);
    }

    args.push(...files);

    const response = await execFlyCLI(args);

    core.setOutput("results", JSON.stringify(response.results));

    const errors = response.results.filter((r) => r.status === "error");
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

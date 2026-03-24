// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { execFlyCLI, getAuthEnv, parseMultilineInput } from "./fly-cli";

export async function runDownload(): Promise<void> {
  try {
    const name = core.getInput("name", { required: true });
    const version = core.getInput("version", { required: true });
    const filesInput = core.getInput("files", { required: true });
    const outputDir = core.getInput("output-dir") || ".";
    const excludeInput = core.getInput("exclude");

    const { url, token } = getAuthEnv();

    const files = parseMultilineInput(filesInput);
    if (files.length === 0) {
      throw new Error("No files specified. Provide at least one remote filename.");
    }

    const args = [
      "download",
      "--name", name,
      "--version", version,
      "--output-dir", outputDir,
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
      core.setFailed(`Download failed for ${errors.length} file(s):\n${summary}`);
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

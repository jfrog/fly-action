// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import { CollectedArtifact } from "./types";

function buildArtifactsTable(artifacts: CollectedArtifact[]): string {
  if (artifacts.length === 0) {
    return "";
  }

  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const header = "| Artifact | Type |\n| --- | --- |";
  const rows = artifacts.map((a) => `| ${esc(a.name)} | ${esc(a.type)} |`);
  return `\n### Collected Artifacts\n\n${header}\n${rows.join("\n")}\n`;
}

export async function createJobSummary(
  artifacts: CollectedArtifact[] = [],
): Promise<void> {
  try {
    const fullRepo = process.env.GITHUB_REPOSITORY;
    const owner = process.env.GITHUB_REPOSITORY_OWNER;
    const workflowName = process.env.GITHUB_WORKFLOW;
    const runNumber = process.env.GITHUB_RUN_NUMBER;

    const baseUrl = "https://fly.jfrog.ai";

    let releaseUrl = baseUrl;
    if (fullRepo && owner && workflowName && runNumber) {
      const repoName = fullRepo.split("/")[1];
      const encodedWorkflowName = encodeURIComponent(workflowName);
      releaseUrl = `${baseUrl}/dashboard/registry/git-repositories/${owner}/${repoName}/releases/${encodedWorkflowName}/${runNumber}/artifacts`;
    }

    const templatePath = path.join(
      __dirname,
      "..",
      "templates",
      "job-summary.md",
    );
    const template = fs.readFileSync(templatePath, "utf8");

    let markdownContent = template.replace("{{RELEASE_URL}}", releaseUrl);

    const artifactsTable = buildArtifactsTable(artifacts);
    markdownContent = markdownContent.replace(
      "{{ARTIFACTS_TABLE}}",
      artifactsTable,
    );

    const summary = core.summary.addRaw(markdownContent);

    await summary.write();
    core.info("Job summary created successfully from markdown template");
  } catch (error) {
    core.warning(`Failed to create job summary: ${error}`);
  }
}

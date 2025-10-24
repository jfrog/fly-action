// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";

export async function createJobSummary(
  packageManagers: string[],
): Promise<void> {
  try {
    // Build release URL
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

    // Read markdown template
    const templatePath = path.join(
      __dirname,
      "..",
      "templates",
      "job-summary.md",
    );
    const template = fs.readFileSync(templatePath, "utf8");

    // Replace template variables - no artifacts table until we have real data
    const markdownContent = template
      .replace("{{ARTIFACTS_SECTION}}", "") // Remove artifacts section
      .replace("{{RELEASE_URL}}", releaseUrl);

    // Create summary from markdown
    const summary = core.summary.addRaw(markdownContent);

    await summary.write();
    core.info("Job summary created successfully from markdown template");
  } catch (error) {
    core.warning(`Failed to create job summary: ${error}`);
  }
}

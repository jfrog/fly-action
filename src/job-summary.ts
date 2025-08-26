import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";

interface Artifact {
  name: string;
  version: string;
  type: string;
  published: string;
}

const PACKAGE_MANAGER_MOCKS: Record<string, Artifact[]> = {
  npm: [
    {
      name: "ascii-frog-frontend",
      version: "1.2.3",
      type: "npm",
      published: "",
    },
    {
      name: "ascii-frog-backend",
      version: "1.2.3",
      type: "npm",
      published: "",
    },
  ],
  docker: [
    { name: "ascii-frog", version: "latest", type: "docker", published: "" },
  ],
};

function generateArtifactsMarkdown(artifacts: Artifact[]): string {
  if (artifacts.length === 0) {
    return "> 📦 No artifacts published";
  }

  const tableHeader =
    "| Artifact | Type | Published |\n|----------|------|-----------|";
  const tableRows = artifacts
    .map(
      (artifact) =>
        `| 📦 ${artifact.name} | ${artifact.type} | ${artifact.published} |`,
    )
    .join("\n");

  return `${tableHeader}\n${tableRows}`;
}

export async function createJobSummary(
  packageManagers: string[],
): Promise<void> {
  try {
    const publishedDate = new Date().toISOString().split("T")[0];

    // Generate artifacts
    const artifacts = packageManagers
      .filter((pm) => PACKAGE_MANAGER_MOCKS[pm.toLowerCase()])
      .flatMap((pm) =>
        PACKAGE_MANAGER_MOCKS[pm.toLowerCase()].map((artifact) => ({
          ...artifact,
          published: publishedDate,
        })),
      );

    // Build release URL
    const fullRepo = process.env.GITHUB_REPOSITORY;
    const owner = process.env.GITHUB_REPOSITORY_OWNER;
    const workflowName = process.env.GITHUB_WORKFLOW;
    const runNumber = process.env.GITHUB_RUN_NUMBER;

    let releaseUrl = "https://fly.jfrogdev.org";
    if (fullRepo && owner && workflowName && runNumber) {
      const repoName = fullRepo.split("/")[1];
      const encodedWorkflowName = encodeURIComponent(workflowName);
      releaseUrl = `https://fly.jfrogdev.org/dashboard/registry/git-repositories/${owner}/${repoName}/releases/${encodedWorkflowName}/${runNumber}/artifacts`;
    }

    // Read markdown template
    const templatePath = path.join(
      __dirname,
      "..",
      "templates",
      "job-summary.md",
    );
    const template = fs.readFileSync(templatePath, "utf8");

    // Generate artifacts section
    const artifactsMarkdown = generateArtifactsMarkdown(artifacts);

    // Replace template variables
    const markdownContent = template
      .replace("{{ARTIFACTS_SECTION}}", artifactsMarkdown)
      .replace("{{RELEASE_URL}}", releaseUrl);

    // Create summary from markdown
    const summary = core.summary.addRaw(markdownContent);

    await summary.write();
    core.info("Job summary created successfully from markdown template");
  } catch (error) {
    core.warning(`Failed to create job summary: ${error}`);
  }
}

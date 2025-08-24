import * as core from "@actions/core";

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
    const jobName = process.env.GITHUB_JOB;

    let releaseUrl = "https://fly.jfrogdev.org";
    if (fullRepo && owner && jobName) {
      const repoName = fullRepo.split("/")[1];
      const encodedJobName = encodeURIComponent(jobName);
      releaseUrl = `https://fly.jfrogdev.org/dashboard/registry/git-repositories/${owner}/${repoName}/releases/${encodedJobName}/${encodedJobName}/artifacts`;
    }

    // Create summary
    let summary = core.summary
      .addHeading("🚀 Fly Action", 1)
      .addRaw("✅ Completed successfully")
      .addBreak()
      .addHeading("📦 Published Artifacts", 2);

    if (artifacts.length === 0) {
      summary = summary.addQuote("📦 No artifacts published");
    } else {
      const tableHeaders = [
        { data: "Artifact", header: true },
        { data: "Version", header: true },
        { data: "Type", header: true },
        { data: "Published", header: true },
      ];

      const tableData = artifacts.map((artifact) => [
        `📦 ${artifact.name}`,
        artifact.version,
        artifact.type,
        artifact.published,
      ]);

      summary = summary.addTable([tableHeaders, ...tableData]);
    }

    summary = summary
      .addBreak()
      .addRaw("---")
      .addBreak()
      .addRaw('<div align="center">')
      .addBreak()
      .addRaw(
        '<img src="https://raw.githubusercontent.com/jfrog/fly-action/main/assets/Fly-logo.svg" alt="JFrog Fly" width="120" height="60">',
      )
      .addBreak()
      .addHeading("🔗 View Release In Fly", 3)
      .addBreak()
      .addRaw("**[📊 Open Release In Fly](" + releaseUrl + ")**")
      .addBreak()
      .addRaw("</div>")
      .addBreak()
      .addRaw("---");

    await summary.write();
    core.info("Job summary created successfully");
  } catch (error) {
    core.warning(`Failed to create job summary: ${error}`);
  }
}

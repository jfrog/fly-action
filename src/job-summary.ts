// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import {
  CollectedArtifact,
  DistributeResponse,
  TransferSummaryEntry,
} from "./types";
import {
  DEFAULT_FLY_URL,
  ENV_FLY_TRANSFER_RESULTS,
  ENV_FLY_DISTRIBUTE_RESULTS,
} from "./constants";
import { getErrorMessage } from "./utils";

const escPipe = (s: string): string => s.replace(/\|/g, "\\|");

function buildArtifactsTable(artifacts: CollectedArtifact[]): string {
  if (artifacts.length === 0) {
    return "";
  }

  const header = "| Artifact | Type |\n| --- | --- |";
  const rows = artifacts.map(
    (a) => `| ${escPipe(a.name)} | ${escPipe(a.type)} |`,
  );
  return `\n### Collected Artifacts\n\n${header}\n${rows.join("\n")}\n`;
}

export function parseTransferResults(raw: string): TransferSummaryEntry[] {
  if (!raw.trim()) return [];
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TransferSummaryEntry);
}

export function buildDistributedTable(results: DistributeResponse[]): string {
  if (results.length === 0) return "";

  const header = "| Package | Version | Download URL |\n| --- | --- | --- |";
  const rows = results.map(
    (r) =>
      `| ${escPipe(r.package_name)} | ${escPipe(r.package_version)} | [${escPipe(r.download_url)}](${r.download_url}) |`,
  );
  return `\n### 🌐 Distributed Artifacts\n\n${header}\n${rows.join("\n")}\n`;
}

export function buildTransfersTable(entries: TransferSummaryEntry[]): string {
  if (entries.length === 0) return "";

  const typeIcon = (type: string) => (type === "upload" ? "⬆️" : "⬇️");
  const statusIcon = (s: string) =>
    s === "success" ? "✅" : s === "error" ? "❌" : "ℹ️";

  const header =
    "| | Type | Package | Version | File | Status |\n| --- | --- | --- | --- | --- | --- |";
  const rows: string[] = [];

  for (const entry of entries) {
    for (const result of entry.results) {
      const cols = [
        typeIcon(entry.type),
        escPipe(entry.type),
        escPipe(entry.name),
        escPipe(entry.version),
        escPipe(result.name),
        `${statusIcon(result.status)} ${escPipe(result.status)}`,
      ];
      rows.push(`| ${cols.join(" | ")} |`);
    }
  }

  return `\n### Uploads & Downloads\n\n${header}\n${rows.join("\n")}\n`;
}

export async function createJobSummary(
  artifacts: CollectedArtifact[] = [],
  flyPlatformUrl?: string,
): Promise<void> {
  try {
    const fullRepo = process.env.GITHUB_REPOSITORY;
    const owner = process.env.GITHUB_REPOSITORY_OWNER;
    const workflowName = process.env.GITHUB_WORKFLOW;
    const runNumber = process.env.GITHUB_RUN_NUMBER;

    const baseUrl = flyPlatformUrl || DEFAULT_FLY_URL;

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

    const transfersRaw = process.env[ENV_FLY_TRANSFER_RESULTS] || "";
    let transfersTable = "";
    try {
      const entries = parseTransferResults(transfersRaw);
      transfersTable = buildTransfersTable(entries);
    } catch (err) {
      core.warning(`Failed to parse transfer results: ${getErrorMessage(err)}`);
    }
    markdownContent = markdownContent.replace(
      "{{TRANSFERS_TABLE}}",
      transfersTable,
    );

    let distributedTable = "";
    try {
      const distributedRaw = process.env[ENV_FLY_DISTRIBUTE_RESULTS] || "";
      if (distributedRaw.trim()) {
        const allResults: DistributeResponse[] = distributedRaw
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .flatMap((line) => JSON.parse(line) as DistributeResponse[]);
        distributedTable = buildDistributedTable(allResults);
      }
    } catch (err) {
      core.warning(
        `Failed to parse distribute results: ${getErrorMessage(err)}`,
      );
    }
    markdownContent = markdownContent.replace(
      "{{DISTRIBUTED_TABLE}}",
      distributedTable,
    );

    const summary = core.summary.addRaw(markdownContent);

    await summary.write();
    core.info("Job summary created successfully from markdown template");
  } catch (error) {
    core.warning(`Failed to create job summary: ${getErrorMessage(error)}`);
  }
}

// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import { CollectedArtifact, TransferSummaryEntry } from "./types";
import { DEFAULT_FLY_URL, ENV_FLY_TRANSFER_RESULTS } from "./constants";
import { getErrorMessage } from "./utils";
import { resolveArtifact, dedupKey } from "./artifact-path";

const escPipe = (s: string): string => s.replace(/\|/g, "\\|");

const TYPE_ORDER: Record<string, number> = {
  npm: 0,
  docker: 1,
  helmoci: 2,
  oci: 3,
  maven: 4,
  pypi: 5,
  nuget: 6,
  go: 7,
  generic: 8,
};

export function formatSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return i === 0 ? `${size} ${units[i]}` : `${size.toFixed(1)} ${units[i]}`;
}

interface TableRow {
  type: string;
  name: string;
  version: string;
  size?: number;
}

export function buildArtifactsTable(artifacts: CollectedArtifact[]): string {
  const seen = new Set<string>();
  const rows: TableRow[] = [];

  for (const artifact of artifacts) {
    const resolved = resolveArtifact(artifact);
    if (resolved.version === "") continue;

    const key = dedupKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({ ...resolved, size: artifact.size });
  }

  if (rows.length === 0) return "";

  rows.sort(
    (a, b) =>
      (TYPE_ORDER[a.type.toLowerCase()] ?? 99) -
      (TYPE_ORDER[b.type.toLowerCase()] ?? 99),
  );

  const hasSize = rows.some((r) => r.size && r.size > 0);
  const cols = hasSize
    ? ["Type", "Package", "Version", "Size"]
    : ["Type", "Package", "Version"];
  const header = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;

  const tableRows = rows.map((r) => {
    const cells = [escPipe(r.type), escPipe(r.name), escPipe(r.version)];
    if (hasSize) cells.push(formatSize(r.size));
    return `| ${cells.join(" | ")} |`;
  });

  return `\n### Collected Artifacts\n\n${header}\n${tableRows.join("\n")}\n`;
}

export function parseTransferResults(raw: string): TransferSummaryEntry[] {
  if (!raw.trim()) return [];
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TransferSummaryEntry);
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

    const jobName = process.env.GITHUB_JOB || "CI Job";

    let markdownContent = template
      .replace("{{JOB_NAME}}", jobName)
      .replace("{{RELEASE_URL}}", releaseUrl);

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

    const summary = core.summary.addRaw(markdownContent);

    await summary.write();
    core.info("Job summary created successfully from markdown template");
  } catch (error) {
    core.warning(`Failed to create job summary: ${getErrorMessage(error)}`);
  }
}

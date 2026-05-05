// Copyright (c) JFrog Ltd. (2025)

import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";
import { getErrorMessage } from "./utils";
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
  LATEST_VERSION,
} from "./constants";
import { FlyClientResult, TransferSummaryEntry } from "./types";

export interface TransferConfig {
  type: "upload" | "download";
  command: string;
  extraArgs: string[];
  noFilesMessage: string;
  // Download only — output directory for files. When the user requests
  // [LATEST], runTransfer bypasses the fly CLI and downloads directly from
  // the public endpoint, so it needs to know where to write files itself.
  outputDir?: string;
}

/**
 * Shared orchestration for upload and download sub-actions.
 *
 * Routing:
 *   - upload                       → fly CLI (authenticated endpoint).
 *   - download + concrete version  → fly CLI (authenticated endpoint).
 *   - download + [LATEST]          → direct anonymous fetch against the
 *     public endpoint (`/public/generic/.../[LATEST]/...`). The fly CLI is
 *     NOT invoked, because the authenticated endpoint is a JPD passthrough
 *     and does NOT resolve [LATEST] — only the public endpoint does, and
 *     only for artifacts that have been publicly distributed.
 */
export async function runTransfer(config: TransferConfig): Promise<void> {
  try {
    const name = core.getInput(INPUT_NAME, { required: true });
    const cliVersion = resolveVersion(
      config.type,
      core.getInput(INPUT_VERSION),
    );
    const filesInput = core.getInput(INPUT_FILES, { required: true });
    const excludeInput = core.getInput(INPUT_EXCLUDE);

    const { url, token } = getAuthEnv();
    core.setSecret(token);

    const files = parseMultilineInput(filesInput);
    if (files.length === 0) {
      throw new Error(config.noFilesMessage);
    }

    const isLatestDownload =
      config.type === "download" && isLatestToken(cliVersion);

    let response: { command: string; results: FlyClientResult[] };
    let displayVersion: string;

    if (isLatestDownload) {
      // Public-URL path. excludes don't apply because we name files exactly
      // (download/action.yml says: "Remote filenames to download — exact names,
      // no glob expansion"). We surface the resolved concrete version for the
      // job summary by parsing it from the redirected URL of the first
      // successful download.
      const outputDir = config.outputDir ?? ".";
      const result = await runPublicLatestDownload(url, name, files, outputDir);
      response = { command: result.command, results: result.results };
      displayVersion = result.resolvedVersion;
    } else {
      const args = [
        config.command,
        CLI_FLAG_NAME,
        name,
        CLI_FLAG_VERSION,
        cliVersion,
        ...config.extraArgs,
      ];

      const excludes = parseMultilineInput(excludeInput);
      for (const pattern of excludes) {
        args.push(CLI_FLAG_EXCLUDE, pattern);
      }

      args.push(...files);

      response = await execFlyCLI(args, {
        [ENV_FLY_URL_RUNTIME]: url,
        [ENV_FLY_ACCESS_TOKEN_RUNTIME]: token,
      });
      displayVersion = cliVersion;
    }

    core.setOutput(OUTPUT_RESULTS, JSON.stringify(response.results));
    appendTransferResults(config.type, name, displayVersion, response.results);

    const errors = response.results.filter((r) => r.status === STATUS_ERROR);
    if (errors.length > 0) {
      const summary = errors.map((e) => `${e.name}: ${e.message}`).join("\n");
      core.setFailed(
        `${capitalize(config.type)} failed for ${errors.length} file(s):\n${summary}`,
      );
    } else {
      core.info(
        `Successfully ${config.type === "upload" ? "uploaded" : "downloaded"} ${response.results.length} file(s) ${config.type === "upload" ? "to" : "from"} ${name}@${displayVersion}`,
      );
    }
  } catch (error) {
    core.setFailed(getErrorMessage(error));
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Returns true if `version` is the case-insensitive [LATEST] sentinel.
 * Mirrors fly-service's isLatestToken (case-insensitive on read).
 */
export function isLatestToken(version: string): boolean {
  return version.trim().toUpperCase() === LATEST_VERSION;
}

/**
 * Streams [LATEST] generic files directly from the anonymous public download
 * endpoint, bypassing the fly CLI entirely.
 *
 * Why the fly CLI is not used here:
 *   - The authenticated endpoint (/fly/api/v1/generic/...) is a JPD passthrough
 *     and does NOT resolve [LATEST]. Hitting it with [LATEST] returns 404.
 *   - The public endpoint (/public/generic/.../[LATEST]/...) DOES resolve it,
 *     via 302 + Cache-Control: no-store, but only for artifacts that have
 *     been publicly distributed.
 *
 * We follow the redirect, write the file to disk, and parse the resolved
 * concrete version from the redirect target so the job summary shows a real
 * version string instead of literal "[LATEST]". A 404 is surfaced as a
 * "not publicly distributed" hint so the user knows to either distribute
 * the artifact or pass a concrete version. Exposed for testing.
 */
export async function runPublicLatestDownload(
  flyUrl: string,
  packageName: string,
  files: string[],
  outputDir: string,
): Promise<{
  command: string;
  results: FlyClientResult[];
  resolvedVersion: string;
}> {
  const baseUrl = flyUrl.replace(/\/+$/, "");
  await fs.promises.mkdir(outputDir, { recursive: true });

  const results: FlyClientResult[] = [];
  let resolvedVersion = LATEST_VERSION;

  for (const fileName of files) {
    const url =
      `${baseUrl}/public/generic/` +
      `${encodeURIComponent(packageName)}/` +
      `${encodeURIComponent(LATEST_VERSION)}/` +
      `${encodeURIComponent(fileName)}`;

    try {
      const resp = await fetch(url, { redirect: "follow" });
      if (!resp.ok) {
        results.push({
          name: fileName,
          status: STATUS_ERROR,
          message:
            resp.status === 404
              ? "not publicly distributed — distribute the artifact first or pass a concrete version"
              : `${resp.status} ${resp.statusText}`,
        });
        continue;
      }

      if (resolvedVersion === LATEST_VERSION) {
        const m = resp.url.match(/\/public\/generic\/[^/]+\/([^/]+)\//);
        if (m && m[1] !== encodeURIComponent(LATEST_VERSION)) {
          resolvedVersion = decodeURIComponent(m[1]);
        }
      }

      const buf = Buffer.from(await resp.arrayBuffer());
      await fs.promises.writeFile(path.join(outputDir, fileName), buf);
      results.push({ name: fileName, status: "success" });
    } catch (err) {
      results.push({
        name: fileName,
        status: STATUS_ERROR,
        message: getErrorMessage(err),
      });
    }
  }

  return {
    command: `public-download ${packageName}/[LATEST]`,
    results,
    resolvedVersion,
  };
}

/**
 * Resolves the version input per sub-action type:
 *   - upload   + missing version → user error (server rejects [LATEST] writes
 *               anyway, and download/action.yml's required:false would let an
 *               empty value through)
 *   - download + missing version → default to "[LATEST]" (the public endpoint
 *               resolves via 302; routing happens in runTransfer)
 *   - either   + provided version → pass through unchanged (including explicit
 *               "[LATEST]" on download)
 *
 * Centralized here so transfer.spec.ts can cover the table without mocking
 * core.getInput's required-flag behavior.
 */
export function resolveVersion(
  type: "upload" | "download",
  rawVersion: string,
): string {
  const trimmed = rawVersion?.trim() ?? "";
  if (trimmed.length > 0) {
    return trimmed;
  }
  if (type === "upload") {
    throw new Error(
      'version is required for upload — pass a concrete version (e.g. "1.0.0", "nightly-2025-03-26"). ' +
        '"[LATEST]" is reserved for download and is rejected on write.',
    );
  }
  return LATEST_VERSION;
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

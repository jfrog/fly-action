// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { HttpClient } from "@actions/http-client";
import { getErrorMessage, DEFAULT_HTTP_TIMEOUT_MS } from "./utils";
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
}

/**
 * Shared orchestration for upload and download sub-actions.
 * Reads common inputs, authenticates, builds CLI args, executes
 * the fly CLI, records results for the job summary, and reports errors.
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

    const response = await execFlyCLI(args, {
      [ENV_FLY_URL_RUNTIME]: url,
      [ENV_FLY_ACCESS_TOKEN_RUNTIME]: token,
    });

    core.setOutput(OUTPUT_RESULTS, JSON.stringify(response.results));

    // For [LATEST] downloads, best-effort-resolve to the concrete version so the
    // job summary shows a real version string instead of literal "[LATEST]".
    // The CLI invocation above still uses literal [LATEST] — fly-service resolves
    // it server-side and proxies the file inline. This call is display-only;
    // on any failure (including the current inline-proxy 200 response) we fall
    // back to displaying the literal token — the download is never blocked.
    const displayVersion =
      config.type === "download" && isLatestToken(cliVersion)
        ? await resolveLatestVersionForDisplay(url, token, name, files[0])
        : cliVersion;

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
 * Best-effort resolve of [LATEST] to a concrete version string for display in
 * the job summary. Issues a HEAD against the authenticated generic endpoint
 * with redirects disabled, then attempts to parse the concrete version.
 *
 * NOTE: fly-service resolves [LATEST] via inline proxying (returns 200 with
 * file content), not a 302 redirect. The 302-check below therefore always
 * falls through, and this function always returns LATEST_VERSION as the
 * display string. The job summary shows the literal "[LATEST]" token rather
 * than the concrete version — download correctness is unaffected.
 *
 * If fly-service later emits an X-Fly-Resolved-Version response header, this
 * function can be updated to read it and show the concrete version.
 *
 * Returns LATEST_VERSION on any response that isn't a 302 (including the
 * current inline-proxy 200), and on any network error.
 */
export async function resolveLatestVersionForDisplay(
  flyUrl: string,
  accessToken: string,
  packageName: string,
  firstFile: string,
): Promise<string> {
  const client = new HttpClient("fly-action", undefined, {
    socketTimeout: DEFAULT_HTTP_TIMEOUT_MS,
    allowRedirects: false,
  });
  try {
    const resolveUrl =
      `${flyUrl.replace(/\/+$/, "")}/fly/api/v1/generic/` +
      `${encodeURIComponent(packageName)}/${LATEST_VERSION}/${encodeURIComponent(firstFile)}`;
    const res = await client.head(resolveUrl, {
      Authorization: `Bearer ${accessToken}`,
    });
    if (res.message.statusCode !== 302) {
      return LATEST_VERSION;
    }
    // Node lowercases incoming HTTP/1 header names per RFC 7230 §3.2 — only
    // `headers["location"]` is ever populated, regardless of how the server
    // cased the wire bytes.
    const rawLocation = res.message.headers["location"];
    const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
    if (typeof location !== "string" || location.length === 0) {
      return LATEST_VERSION;
    }
    const match = location.match(/\/fly\/api\/v1\/generic\/[^/]+\/([^/]+)\//);
    if (!match) {
      return LATEST_VERSION;
    }
    return decodeURIComponent(match[1]);
  } catch (err) {
    core.warning(
      `Could not resolve [LATEST] for job summary: ${getErrorMessage(err)}`,
    );
    return LATEST_VERSION;
  } finally {
    client.dispose();
  }
}

/**
 * Resolves the version input per sub-action type:
 *   - upload   + missing version → user error (server rejects [LATEST] writes anyway,
 *               and download/action.yml's required:false would let an empty value through)
 *   - download + missing version → default to "[LATEST]" (server resolves via 302)
 *   - either   + provided version → pass through unchanged (including explicit "[LATEST]" on download)
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
 *
 * Only the rendered fields (name + status) are persisted — see
 * {@link TransferSummaryResult} / #69. `results[]` scales with file count, so
 * dropping the unused `message` keeps the accumulated env var from drifting
 * toward the 128 KB E2BIG wall. The full results (with `message`) are still
 * exposed verbatim via the step `results` output.
 */
export function appendTransferResults(
  type: "upload" | "download",
  name: string,
  version: string,
  results: FlyClientResult[],
): void {
  const entry: TransferSummaryEntry = {
    type,
    name,
    version,
    results: results.map((r) => ({ name: r.name, status: r.status })),
  };
  const existing = process.env[ENV_FLY_TRANSFER_RESULTS] || "";
  const line = JSON.stringify(entry);
  const updated = existing ? `${existing}\n${line}` : line;
  core.exportVariable(ENV_FLY_TRANSFER_RESULTS, updated);
}

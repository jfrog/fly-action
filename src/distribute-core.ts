// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { createHttpClient, truncate } from "./utils";
import {
  DistributeEntry,
  DistributeRequest,
  DistributeResponse,
} from "./types";

const REQUEST_TIMEOUT_MS = 30000;

/**
 * A single entry that failed to distribute. Returned alongside successes so
 * the caller can emit partial output and report which artifacts failed.
 */
export interface DistributeFailure {
  entry: DistributeEntry;
  error: string;
}

/**
 * Result of distributing a batch of entries. Successes and failures are kept
 * separate so callers can emit successful public URLs even on partial failure.
 */
export interface DistributeOutcome {
  successes: DistributeResponse[];
  failures: DistributeFailure[];
}

/**
 * Parses a comma-separated "name:version" string into structured entries.
 * Example: "my-app:1.0.0, my-lib:2.3.1" → [{name: "my-app", version: "1.0.0", type: "generic"}, ...]
 */
export function parseDistributeInput(
  input: string,
  packageType: string,
): DistributeEntry[] {
  return input
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const colonIdx = entry.lastIndexOf(":");
      if (colonIdx <= 0) {
        throw new Error(
          `Invalid distribute entry "${entry}". Expected format: "name:version".`,
        );
      }
      return {
        name: entry.slice(0, colonIdx).trim(),
        version: entry.slice(colonIdx + 1).trim(),
        type: packageType,
      };
    });
}

/**
 * Distributes one or more artifacts by calling the Fly backend.
 *
 * Collects per-entry results — a failure on one entry never aborts the remaining
 * entries and never discards already-successful results. The caller is responsible
 * for emitting `successes` to workflow outputs and failing the action when
 * `failures` is non-empty. This mirrors the per-file result pattern used by the
 * upload/download sub-actions (see `transfer.ts`).
 */
export async function distributeArtifacts(
  flyUrl: string,
  accessToken: string,
  entries: DistributeEntry[],
): Promise<DistributeOutcome> {
  const httpClient = createHttpClient("fly-action", REQUEST_TIMEOUT_MS);
  const successes: DistributeResponse[] = [];
  const failures: DistributeFailure[] = [];

  // Derive the tenant host from flyUrl so the backend builds correct public URLs.
  const tenantHost = flyUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  try {
    for (const entry of entries) {
      try {
        const url = `${flyUrl}/fly/api/v1/artifacts/distribute`;
        const payload: DistributeRequest = {
          package_name: entry.name,
          package_version: entry.version,
          package_type: entry.type,
        };

        core.info(
          `Distributing ${entry.name}:${entry.version} (${entry.type})`,
        );

        const response = await httpClient.post(url, JSON.stringify(payload), {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "X-JFROG-FLY-TENANT-HOST": tenantHost,
        });

        const statusCode = response.message.statusCode ?? 0;
        const responseBody = await response.readBody();

        if (statusCode !== 200) {
          throw new Error(
            `Status: ${statusCode}. Body: ${truncate(responseBody)}`,
          );
        }

        const parsed: DistributeResponse = JSON.parse(responseBody);
        successes.push(parsed);

        core.info(
          `✅ Distributed ${parsed.package_name}:${parsed.package_version}`,
        );
        core.info(`   Public URL: ${parsed.public_url}`);
        core.info(`   Download:   ${parsed.download_url}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        core.error(
          `❌ Failed to distribute ${entry.name}:${entry.version} — ${message}`,
        );
        failures.push({ entry, error: message });
      }
    }
  } finally {
    httpClient.dispose();
  }

  return { successes, failures };
}

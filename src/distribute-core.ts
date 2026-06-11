// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { HttpCodes, Headers, MediaTypes } from "@actions/http-client";
import { createHttpClient, truncate } from "./utils";
import { DistributeRequest, DistributeResponse } from "./types";

const REQUEST_TIMEOUT_MS = 30000;

/**
 * Distributes a single artifact by calling the Fly backend. Mirrors the
 * single-coordinate shape of the upload/download sub-actions: one invocation =
 * one package coordinate. Callers needing to distribute multiple artifacts
 * compose several distribute steps (e.g. via `strategy.matrix`).
 *
 * Throws on any non-200 response or network error — the caller surfaces the
 * error via `core.setFailed`, matching the transfer sub-action contract.
 */
export async function distributeArtifact(
  flyUrl: string,
  accessToken: string,
  name: string,
  version: string,
  packageType: string,
): Promise<DistributeResponse> {
  const httpClient = createHttpClient("fly-action", REQUEST_TIMEOUT_MS);

  // Derive the tenant host from flyUrl so the backend builds correct public URLs.
  const tenantHost = flyUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  try {
    const url = `${flyUrl}/fly/api/v1/artifacts/distribute`;
    const payload: DistributeRequest = {
      package_name: name,
      package_version: version,
      package_type: packageType,
    };

    core.info(`Distributing ${name}:${version} (${packageType})`);

    const response = await httpClient.post(url, JSON.stringify(payload), {
      Authorization: `Bearer ${accessToken}`,
      [Headers.ContentType]: MediaTypes.ApplicationJson,
      "X-JFROG-FLY-TENANT-HOST": tenantHost,
    });

    const statusCode = response.message.statusCode ?? 0;
    const responseBody = await response.readBody();

    if (statusCode !== HttpCodes.OK) {
      throw new Error(
        `Failed to distribute ${name}:${version}. ` +
          `Status: ${statusCode}. Body: ${truncate(responseBody)}`,
      );
    }

    const parsed: DistributeResponse = JSON.parse(responseBody);

    core.info(
      `✅ Distributed ${parsed.package_name}:${parsed.package_version}`,
    );
    // Only log links that resolve to something a consumer can use:
    //   - Docker: the `docker pull …` command. `public_url` is the OCI
    //     namespace and `download_url` is the manifest API endpoint — neither
    //     is browser-clickable (both 404 when opened), so we never print them.
    //   - Generic: the `download_url` (the direct file). `public_url` is the
    //     version folder, which has no route on the backend and 404s, so it is
    //     dropped.
    const pullCommand = buildDockerPullCommand(parsed);
    if (pullCommand) {
      core.info(`   Pull:       ${pullCommand}`);
    } else {
      core.info(`   Download:   ${parsed.download_url}`);
    }

    return parsed;
  } finally {
    httpClient.dispose();
  }
}

/**
 * Returns the `docker pull …` reference for a Docker distribution, or `null`
 * for non-Docker types or when `public_url` doesn't match the expected
 * `/v2/{repo}/{image}` shape. Surfacing the pull command is the most useful
 * line for a Docker consumer — `public_url` alone is the OCI namespace, not a
 * command they can paste, and `download_url` resolves to the JSON manifest.
 *
 * Exported so the job-summary renderer can reuse the same derivation and
 * stay consistent with the step log line (no drift between sources).
 */
export function buildDockerPullCommand(
  response: DistributeResponse,
): string | null {
  if (response.package_type !== "docker") {
    return null;
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(response.public_url);
  } catch {
    return null;
  }
  // public_url is `/v2/{repo}/{image}` per the Fly OCI public namespace
  // contract. Strip the OCI `/v2/` prefix so the result is the docker
  // reference `{host}/{repo}/{image}:{tag}`. If the prefix is missing the
  // backend changed shape — skip rather than emit a misleading command.
  const pathWithoutV2 = parsedUrl.pathname.replace(/^\/v2\//, "/");
  if (pathWithoutV2 === parsedUrl.pathname) {
    return null;
  }
  return `docker pull ${parsedUrl.host}${pathWithoutV2}:${response.package_version}`;
}

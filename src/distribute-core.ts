// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
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
      "content-type": "application/json",
      "X-JFROG-FLY-TENANT-HOST": tenantHost,
    });

    const statusCode = response.message.statusCode ?? 0;
    const responseBody = await response.readBody();

    if (statusCode !== 200) {
      throw new Error(
        `Failed to distribute ${name}:${version}. ` +
          `Status: ${statusCode}. Body: ${truncate(responseBody)}`,
      );
    }

    const parsed: DistributeResponse = JSON.parse(responseBody);

    core.info(
      `✅ Distributed ${parsed.package_name}:${parsed.package_version}`,
    );
    core.info(`   Public URL: ${parsed.public_url}`);
    core.info(`   Download:   ${parsed.download_url}`);

    return parsed;
  } finally {
    httpClient.dispose();
  }
}

// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import {
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PLATFORM_URL,
} from "./constants";
import { HttpCodes, Headers, MediaTypes } from "@actions/http-client";
import { EndCiResponse, CollectedArtifact } from "./types";
import { createHttpClient, getErrorMessage, truncate } from "./utils";
import { createJobSummary } from "./job-summary";
import { executeWithRetry, isTransientHttpError } from "./retry";

const REQUEST_TIMEOUT_MS = 10000;

export async function runPost(): Promise<void> {
  const flyUrl = core.getState(STATE_FLY_URL);
  const accessToken = core.getState(STATE_FLY_ACCESS_TOKEN);

  if (!flyUrl) {
    core.info("No Fly URL found in state, skipping CI end notification");
    return;
  }
  if (!accessToken) {
    core.info("No access token found in state, skipping CI end notification");
    return;
  }

  core.info("🏁 Notifying Fly that CI job has ended...");

  core.info(`Fly API URL: ${flyUrl}/fly/api/v1/ci/end`);

  const httpClient = createHttpClient("fly-action", REQUEST_TIMEOUT_MS);
  core.info(
    `[${new Date().toISOString()}] Attempting to send CI end notification to Fly...`,
  );

  const url = `${flyUrl}/fly/api/v1/ci/end`;
  try {
    const response = await executeWithRetry(
      async () => {
        const res = await httpClient.post(url, "{}", {
          Authorization: `Bearer ${accessToken}`,
          [Headers.ContentType]: MediaTypes.ApplicationJson,
        });
        const statusCode = res.message.statusCode ?? 0;
        if (isTransientHttpError(null, statusCode)) {
          throw new Error(`Server error ${statusCode}`);
        }
        return res;
      },
      {
        isRetryable: (err) => {
          const match = err.message.match(/\bServer error (\d+)\b/);
          const code = match ? parseInt(match[1], 10) : undefined;
          return isTransientHttpError(err, code);
        },
        initialDelayMs: 1000,
        label: "ci/end",
      },
    );

    core.info(
      `[${new Date().toISOString()}] Received response with status code: ${response.message.statusCode}`,
    );
    if (response.message.statusCode === HttpCodes.OK) {
      core.info("✅ CI end notification completed successfully");

      let artifacts: CollectedArtifact[] = [];
      try {
        const body = await response.readBody();
        const parsed: EndCiResponse = JSON.parse(body);
        artifacts = parsed.artifacts || [];
        if (artifacts.length > 0) {
          core.info(
            `Collected ${artifacts.length} artifact(s) from CI workflow`,
          );
        }
      } catch (e) {
        core.info(
          `No artifacts in ci/end response (${e instanceof Error ? e.message : String(e)})`,
        );
      }

      core.info("📋 Creating job summary...");
      const flyPlatformUrl = core.getState(STATE_FLY_PLATFORM_URL);
      await createJobSummary(artifacts, flyPlatformUrl || undefined);
    } else {
      const body = await response.readBody();
      core.debug(`Full ci/end error body: ${body}`);
      const msg = `Failed to send CI end notification. Status: ${response.message.statusCode}. Body: ${truncate(body)}`;
      core.error(msg);
      throw new Error(msg);
    }
  } catch (error: unknown) {
    core.error(`Error during CI end notification: ${getErrorMessage(error)}`);
    throw error;
  } finally {
    httpClient.dispose();
  }
}

export async function runPostScriptLogic(): Promise<void> {
  try {
    await runPost();
  } catch (error: unknown) {
    core.setFailed(getErrorMessage(error));
  }
}

if (require.main === module) {
  runPostScriptLogic();
}

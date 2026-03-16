// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { STATE_FLY_URL, STATE_FLY_ACCESS_TOKEN } from "./constants";
import { HttpClient, HttpClientResponse } from "@actions/http-client";
import { EndCiResponse, CollectedArtifact } from "./types";
import { createHttpClient } from "./utils";
import { createJobSummary } from "./job-summary";

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second
const REQUEST_TIMEOUT_MS = 10000; // 10 seconds (ci/end is a fast Redis lookup)

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an HTTP POST request with retry logic and exponential backoff
 */
async function postWithRetry(
  httpClient: HttpClient,
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<HttpClientResponse> {
  let lastError: Error = new Error("Request failed after retries");
  let lastResponse: HttpClientResponse | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      core.info(
        `[${new Date().toISOString()}] Attempt ${attempt}/${MAX_RETRIES} - Sending request to ${url}`,
      );

      const response = await httpClient.post(url, body, headers);
      const statusCode = response.message.statusCode ?? 0;

      if (statusCode < 500) {
        return response;
      }

      lastResponse = response;
      lastError = new Error(`Server error ${statusCode}`);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < MAX_RETRIES) {
      const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      core.warning(
        `Request failed (attempt ${attempt}/${MAX_RETRIES}): ${lastError.message}. Retrying in ${delayMs}ms...`,
      );
      await sleep(delayMs);
    } else {
      core.error(
        `Request failed after ${MAX_RETRIES} attempts: ${lastError.message}`,
      );
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError;
}

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

  try {
    const response = await postWithRetry(
      httpClient,
      `${flyUrl}/fly/api/v1/ci/end`,
      "{}",
      {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
    );

    core.info(
      `[${new Date().toISOString()}] Received response with status code: ${response.message.statusCode}`,
    );
    if (response.message.statusCode === 200) {
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
      await createJobSummary(artifacts);
    } else {
      const body = await response.readBody();
      core.error(
        `Failed to send CI end notification. Status: ${response.message.statusCode}. Body: ${body}`,
      );
      throw new Error(
        `Failed to send CI end notification. Status: ${response.message.statusCode}. Body: ${body}`,
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.error(`Error during CI end notification: ${message}`);
    // Re-throw the error to be caught by the mainRunner or the test
    throw error;
  } finally {
    httpClient.dispose();
  }
}

// New exported function to handle the main execution logic
export async function runPostScriptLogic(): Promise<void> {
  try {
    await runPost();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}

// Original main execution block, now calling runPostScriptLogic
if (require.main === module) {
  runPostScriptLogic();
}

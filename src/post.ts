import * as core from "@actions/core";
import {
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PACKAGE_MANAGERS,
} from "./constants";
import { HttpClient } from "@actions/http-client";
import { EndCiRequest } from "./types";
import { createJobSummary } from "./job-summary";

export async function runPost(): Promise<void> {
  core.info("🏁 Notifying Fly that CI job has ended...");

  const flyUrl = core.getState(STATE_FLY_URL); // Corrected constant
  const accessToken = core.getState(STATE_FLY_ACCESS_TOKEN); // Corrected constant

  if (!flyUrl) {
    core.info("No Fly URL found in state, skipping CI end notification"); // Changed from debug to info
    return;
  }
  if (!accessToken) {
    core.info("No access token found in state, skipping CI end notification"); // Changed from debug to info
    return;
  }

  const packageManagersState = core.getState(STATE_FLY_PACKAGE_MANAGERS);
  let packageManagers: string[] = [];
  if (packageManagersState) {
    try {
      packageManagers = JSON.parse(packageManagersState);
    } catch (error) {
      core.warning(
        `Failed to parse package managers from state: ${packageManagersState}. Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Hardcoded status
  const determinedStatus = "success";
  core.info(`Job status: ${determinedStatus}`); // Changed from debug to info

  const payload: EndCiRequest = {
    status: determinedStatus,
  };
  if (packageManagers && packageManagers.length > 0) {
    payload.package_managers = packageManagers;
  }

  core.info(`Fly API URL: ${flyUrl}/fly/api/v1/ci/end`); // Changed from debug to info
  core.info(`Request payload: ${JSON.stringify(payload)}`);

  const httpClient = new HttpClient("fly-action");
  core.info(
    `[${new Date().toISOString()}] Attempting to send CI end notification to Fly...`,
  );

  try {
    const response = await httpClient.post(
      `${flyUrl}/fly/api/v1/ci/end`,
      JSON.stringify(payload),
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
      await createJobSummary(packageManagers);
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
    core.error(`Error during CI end notification: ${message}`); // Use core.error for better visibility
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

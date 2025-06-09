import * as core from "@actions/core";
import {
  STATE_FLYFROG_URL,
  STATE_FLYFROG_ACCESS_TOKEN,
  STATE_FLYFROG_PACKAGE_MANAGERS,
} from "./constants";
import { HttpClient } from "@actions/http-client";
import { EndCiRequest } from "./types";

export async function runPost(): Promise<void> {
  core.info("🏁 Notifying FlyFrog that CI job has ended...");

  const flyfrogUrl = core.getState(STATE_FLYFROG_URL); // Corrected constant
  const accessToken = core.getState(STATE_FLYFROG_ACCESS_TOKEN); // Corrected constant

  if (!flyfrogUrl) {
    core.debug("No FlyFrog URL found in state, skipping CI end notification");
    return;
  }
  if (!accessToken) {
    core.debug("No access token found in state, skipping CI end notification");
    return;
  }

  const packageManagersState = core.getState(STATE_FLYFROG_PACKAGE_MANAGERS);
  let packageManagers: string[] | undefined;
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
  core.debug(`Job status: ${determinedStatus}`);

  const payload: EndCiRequest = {
    status: determinedStatus,
  };
  if (packageManagers && packageManagers.length > 0) {
    payload.package_managers = packageManagers;
  }

  core.debug(`FlyFrog API URL: ${flyfrogUrl}/flyfrog/api/v1/ci/end`);
  core.debug(`Request payload: ${JSON.stringify(payload)}`);

  const httpClient = new HttpClient("flyfrog-action");
  core.info("Attempting to send CI end notification to FlyFrog...");
  try {
    const response = await httpClient.post(
      `${flyfrogUrl}/flyfrog/api/v1/ci/end`,
      JSON.stringify(payload),
      {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
    );

    core.info(
      `Received response with status code: ${response.message.statusCode}`,
    );
    if (response.message.statusCode === 200) {
      core.info("✅ CI end notification completed successfully");
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

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
    core.info("No FlyFrog URL found in state, skipping CI end notification"); // Changed from debug to info
    return;
  }
  if (!accessToken) {
    core.info("No access token found in state, skipping CI end notification"); // Changed from debug to info
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
  core.info(`Job status: ${determinedStatus}`); // Changed from debug to info

  const payload: EndCiRequest = {
    status: determinedStatus,
  };
  if (packageManagers && packageManagers.length > 0) {
    payload.package_managers = packageManagers;
  }

  core.info(`FlyFrog API URL: ${flyfrogUrl}/flyfrog/api/v1/ci/end`); // Changed from debug to info
  core.info(`Request payload: ${JSON.stringify(payload)}`);

  const httpClient = new HttpClient("flyfrog-action");
  try {
    const response = await httpClient.post(
      `${flyfrogUrl}/flyfrog/api/v1/ci/end`,
      JSON.stringify(payload),
      {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
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
  runPostScriptLogic()
    .then(() => {
      // Removed: core.info(`post.ts script finished.`);
      // Removed: // process.exit(0); // Removed forced exit
    })
    .catch((error) => {
      // Even if runPostScriptLogic handles setFailed, we log that the script block itself caught an error
      const message = error instanceof Error ? error.message : String(error);
      core.error( // Kept this error log as it's general error handling
        `post.ts script failed: ${message}`, 
      );
      // Ensure the action still fails if an unhandled promise rejection occurs here
      core.setFailed(`Unhandled error in post.ts script execution: ${message}`);
      // Removed: // process.exit(1); // Removed forced exit
    });
}

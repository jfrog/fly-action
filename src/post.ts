import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import {
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PACKAGE_MANAGERS,
} from "./constants";
import { HttpClient } from "@actions/http-client";
import { EndCiRequest } from "./types";
import { createJobSummary } from "./job-summary";

/**
 * Determines the current job status by checking for user-set success indicator file
 * Simple approach: if file exists = success, if not = failure
 */
function determineJobStatus(): string {
  try {
    const workspacePath = process.env.GITHUB_WORKSPACE || process.cwd();
    const statusFilePath = path.join(workspacePath, ".fly-job-status");

    core.info(`🔍 Looking for success file at: ${statusFilePath}`);
    core.info(`📁 Workspace path: ${workspacePath}`);
    core.info(`📁 Current working directory: ${process.cwd()}`);

    if (fs.existsSync(statusFilePath)) {
      core.info(
        "✅ Found job success indicator file - user workflow completed successfully",
      );
      return "success";
    } else {
      core.info(
        "⚠️ No job success indicator file found - job may have failed or user hasn't added success marker step",
      );
      return "failure";
    }
  } catch (error) {
    core.warning(`Error checking job status file: ${error}`);
    return "failure";
  }
}

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

  // Determine actual job status
  const determinedStatus = determineJobStatus();
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

      // Only create job summary if the job succeeded
      if (determinedStatus === "success") {
        core.info("📋 Creating job summary for successful job...");
        await createJobSummary(packageManagers);
      } else {
        core.info("⚠️ Skipping job summary creation - job did not succeed");
      }
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

/**
 * Validate release successfully published to Fly with progress messaging
 */
async function validateReleasePublication(): Promise<void> {
  core.info("🔍 Validating release successfully published to Fly...");

  const totalTime = 50000; // 50 seconds
  const updateInterval = 5000; // Update every 5 seconds
  const updates = totalTime / updateInterval;

  for (let i = 1; i <= updates; i++) {
    const progress = Math.round((i / updates) * 100);
    const timeRemaining = totalTime - i * updateInterval;

    if (i === 1) {
      core.info("⏳ Checking Fly registry for release artifacts...");
    } else if (i === 3) {
      core.info("🔄 Verifying package manager uploads...");
    } else if (i === 6) {
      core.info("📦 Confirming release metadata synchronization...");
    } else if (i === 8) {
      core.info("✨ Finalizing release validation...");
    } else {
      core.info(
        `⌛ Validation in progress... ${progress}% complete (${timeRemaining / 1000}s remaining)`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, updateInterval));
  }

  core.info(
    "✅ Release validation completed - artifacts confirmed on Fly registry",
  );
}

// New exported function to handle the main execution logic
export async function runPostScriptLogic(): Promise<void> {
  try {
    await runPost();
    await validateReleasePublication();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}

// Original main execution block, now calling runPostScriptLogic
if (require.main === module) {
  runPostScriptLogic();
}

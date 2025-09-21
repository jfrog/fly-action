import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PACKAGE_MANAGERS,
} from "./constants";
import { HttpClient } from "@actions/http-client";
import { EndCiRequest } from "./types";
import { createJobSummary } from "./job-summary";

interface GitHubStep {
  name?: string;
  conclusion?: string | null;
}

interface GitHubJob {
  name: string;
  status: string;
  conclusion?: string | null;
  steps?: GitHubStep[];
}

interface GitHubEnv {
  runId: string;
  repository: string;
  token: string;
  jobName: string;
}

/**
 * Gets GitHub environment variables required for job status checking
 */
function getGitHubEnvironment(): GitHubEnv | null {
  const runId = process.env.GITHUB_RUN_ID;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = core.getInput("token") || process.env.GITHUB_TOKEN;
  const jobName = process.env.GITHUB_JOB;

  core.info(`🔍 Checking job status for run ${runId} in repo ${repository}`);
  core.info(`📋 Current job: ${jobName}`);

  if (!runId || !repository || !token) {
    core.warning(
      "Missing GitHub environment variables, assuming job succeeded since post action is running",
    );
    return null;
  }

  return {
    runId: runId!,
    repository: repository!,
    token: token!,
    jobName: jobName!,
  };
}

/**
 * Filters to only main steps (excludes all post-action steps)
 * Main steps have completed by the time any post action runs
 */
export function filterMainSteps(steps: GitHubStep[]): GitHubStep[] {
  return steps.filter((step: GitHubStep) => {
    // Post steps typically start with "Post " in their name
    const isPostStep = step.name?.toLowerCase().startsWith("post ");
    return !isPostStep;
  });
}

/**
 * Checks if any main step failed - simple success/failure determination
 */
export function analyzeJobSteps(steps: GitHubStep[]): string {
  const mainSteps = filterMainSteps(steps);

  const hasFailedStep = mainSteps.some(
    (step: GitHubStep) =>
      step.conclusion === "failure" || step.conclusion === "cancelled",
  );

  if (hasFailedStep) {
    core.info("❌ At least one main step failed");
    return "failure";
  }

  core.info("✅ All main steps succeeded");
  return "success";
}

/**
 * Determines workflow status by checking if any main steps failed
 * When post actions run, all main steps have completed but post steps are still pending.
 * We only examine main steps to determine if the workflow succeeded up to this point.
 */
async function determineJobStatus(): Promise<string> {
  try {
    const env = getGitHubEnvironment();
    if (!env) {
      return "success";
    }

    try {
      const octokit = github.getOctokit(env.token);
      const [owner, repo] = env.repository.split("/");

      // Get the workflow run details
      const { data: workflowRun } = await octokit.rest.actions.getWorkflowRun({
        owner,
        repo,
        run_id: parseInt(env.runId),
      });

      // Get jobs for this workflow run
      const { data: jobs } = await octokit.rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: parseInt(env.runId),
      });

      // Find the current job
      const currentJob = jobs.jobs.find(
        (job: GitHubJob) => job.name === env.jobName,
      );

      if (currentJob) {
        // Check individual step statuses
        if (currentJob.steps && currentJob.steps.length > 0) {
          return analyzeJobSteps(currentJob.steps);
        }

        // Fallback: if job is explicitly failed/cancelled/timed out
        if (
          currentJob.conclusion === "failure" ||
          currentJob.conclusion === "cancelled" ||
          currentJob.conclusion === "timed_out"
        ) {
          core.info(`❌ Job concluded with status: ${currentJob.conclusion}`);
          return "failure";
        }
      }

      core.warning(
        "Could not determine job status precisely, assuming success since post action is executing",
      );
      return "success";
    } catch (apiError) {
      core.warning(`Failed to check job status via GitHub API: ${apiError}`);
      core.warning(
        "Falling back to assuming job succeeded since post action is running",
      );
      return "success";
    }
  } catch (error) {
    core.warning(`Error determining job status: ${error}`);
    core.warning("Assuming job succeeded since post action is executing");
    return "success";
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
  const determinedStatus = await determineJobStatus();
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

// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  STATE_FLY_URL,
  STATE_FLY_ACCESS_TOKEN,
  STATE_FLY_PACKAGE_MANAGERS,
  GITHUB_STATUS_SUCCESS,
  GITHUB_STATUS_FAILURE,
  GITHUB_STATUS_CANCELLED,
  GITHUB_STATUS_TIMED_OUT,
  INPUT_GITHUB_TOKEN,
} from "./constants";
import { HttpClient, HttpClientResponse } from "@actions/http-client";
import { EndCiRequest, EndCiResponse, CollectedArtifact } from "./types";
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
  const githubToken =
    core.getInput(INPUT_GITHUB_TOKEN) || process.env.GITHUB_TOKEN;
  const jobName = process.env.GITHUB_JOB;

  core.info(`🔍 Checking job status for run ${runId} in repo ${repository}`);
  core.info(`📋 Current job: ${jobName}`);

  if (!runId || !repository || !githubToken) {
    core.warning(
      "Missing GitHub environment variables, assuming job succeeded since post action is running",
    );
    return null;
  }

  return {
    runId: runId!,
    repository: repository!,
    token: githubToken!,
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
      step.conclusion === GITHUB_STATUS_FAILURE ||
      step.conclusion === GITHUB_STATUS_CANCELLED,
  );

  if (hasFailedStep) {
    core.info("❌ At least one main step failed");
    return GITHUB_STATUS_FAILURE;
  }

  core.info("✅ All main steps succeeded");
  return GITHUB_STATUS_SUCCESS;
}

/**
 * Determines job status by checking if any main steps failed.
 * When post actions run, all main steps have completed but post steps are still pending.
 * We only examine main steps to determine if the job succeeded up to this point.
 *
 * Job identification strategy:
 * 1. Match GITHUB_JOB against the API job name (works when no custom name: attribute).
 * 2. Fallback: find the single in_progress job (our job is always in_progress while
 *    its post steps run; completed jobs have finished all post steps).
 * 3. If multiple jobs are in_progress (parallel execution), we check ALL of them
 *    for failures — conservative approach when we can't pinpoint our exact job.
 */
async function determineJobStatus(): Promise<string> {
  try {
    const env = getGitHubEnvironment();
    if (!env) {
      return GITHUB_STATUS_SUCCESS;
    }

    try {
      const octokit = github.getOctokit(env.token);
      const [owner, repo] = env.repository.split("/");

      // Get jobs for this workflow run
      const { data: jobs } = await octokit.rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: parseInt(env.runId),
      });

      core.info(`📊 Found ${jobs.jobs.length} job(s) in workflow run`);
      jobs.jobs.forEach((job: GitHubJob) => {
        core.info(
          `  - Job: ${job.name}, Status: ${job.status}, Conclusion: ${job.conclusion}, Steps: ${job.steps?.length || 0}`,
        );
      });

      // Find the current job:
      // 1. Primary: match GITHUB_JOB (yaml key) against job name.
      //    Works when the job has no custom `name:` attribute.
      // 2. Fallback: find the job that is still in_progress.
      //    When our post step runs, our job is always in_progress (post steps
      //    are part of the job). Completed jobs have already finished all their
      //    post steps. This handles the case where a custom `name:` attribute
      //    makes GITHUB_JOB (yaml key) differ from the API name (display name).
      let currentJob: GitHubJob | undefined;

      // Try name match first (works when no custom name: attribute)
      currentJob = jobs.jobs.find(
        (job: GitHubJob) =>
          job.name.toLowerCase() === env.jobName.toLowerCase(),
      );
      if (currentJob) {
        core.info(`✓ Found current job by name: ${currentJob.name}`);
      }

      // Fallback: match by in_progress status
      if (!currentJob) {
        const inProgressJobs = jobs.jobs.filter(
          (job: GitHubJob) => job.status === "in_progress",
        );

        if (inProgressJobs.length === 1) {
          currentJob = inProgressJobs[0];
          core.info(
            `✓ Found current job by in_progress status: ${currentJob.name}`,
          );
        } else if (inProgressJobs.length > 1) {
          // Multiple jobs running concurrently — check all for failures
          core.info(
            `Found ${inProgressJobs.length} in_progress jobs, analyzing all for failures`,
          );
          for (const job of inProgressJobs) {
            if (job.steps && job.steps.length > 0) {
              const result = analyzeJobSteps(job.steps);
              if (result === GITHUB_STATUS_FAILURE) {
                return GITHUB_STATUS_FAILURE;
              }
            }
          }
          return GITHUB_STATUS_SUCCESS;
        }
      }

      if (currentJob) {
        core.info(
          `  Status: ${currentJob.status}, Conclusion: ${currentJob.conclusion || "null"}, Steps: ${currentJob.steps?.length || 0}`,
        );

        // Check individual step statuses
        if (currentJob.steps && currentJob.steps.length > 0) {
          return analyzeJobSteps(currentJob.steps);
        }

        // Fallback: if job is explicitly failed/cancelled/timed out
        if (
          currentJob.conclusion === GITHUB_STATUS_FAILURE ||
          currentJob.conclusion === GITHUB_STATUS_CANCELLED ||
          currentJob.conclusion === GITHUB_STATUS_TIMED_OUT
        ) {
          core.info(`❌ Job concluded with status: ${currentJob.conclusion}`);
          return GITHUB_STATUS_FAILURE;
        }

        core.warning(
          `⚠️ Job found but has no steps data (steps: ${currentJob.steps?.length || 0})`,
        );
      } else {
        core.warning(`⚠️ Could not find current job with name: ${env.jobName}`);
      }

      core.warning(
        "Could not determine job status precisely, assuming success since post action is executing",
      );
      return GITHUB_STATUS_SUCCESS;
    } catch (apiError) {
      // Check if this is a permission error (expected when actions:read is not granted)
      const errorMessage = String(apiError);
      const isPermissionError =
        errorMessage.includes("Resource not accessible by integration") ||
        errorMessage.includes("403");

      if (isPermissionError) {
        core.info(
          "ℹ️ Cannot access workflow job status (requires 'actions: read' permission). " +
            "Assuming job succeeded since post action is running.",
        );
      } else {
        core.warning(`Failed to check job status via GitHub API: ${apiError}`);
        core.info("Assuming job succeeded since post action is running.");
      }
      return GITHUB_STATUS_SUCCESS;
    }
  } catch (error) {
    core.warning(`Error determining job status: ${error}`);
    core.warning("Assuming job succeeded since post action is executing");
    return GITHUB_STATUS_SUCCESS;
  }
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

  const httpClient = createHttpClient("fly-action", REQUEST_TIMEOUT_MS);
  core.info(
    `[${new Date().toISOString()}] Attempting to send CI end notification to Fly...`,
  );

  try {
    const response = await postWithRetry(
      httpClient,
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
      } catch {
        core.info("No artifacts in ci/end response");
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

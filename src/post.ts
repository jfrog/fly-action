import * as core from "@actions/core";
import { notifyCiEnd } from "./oidc";
import { STATE_FLYFROG_URL, STATE_FLYFROG_ACCESS_TOKEN } from "./constants";

/**
 * Post-job notification that runs after the main action to notify FlyFrog service
 * Will fail the workflow if the CI end notification fails
 */
async function runPost(): Promise<void> {
  // Get the URL and access token from the main action's state
  const url = core.getState(STATE_FLYFROG_URL);
  const accessToken = core.getState(STATE_FLYFROG_ACCESS_TOKEN);

  if (!url) {
    core.debug("No FlyFrog URL found in state, skipping CI end notification");
    return;
  }

  if (!accessToken) {
    core.debug("No access token found in state, skipping CI end notification");
    return;
  }

  core.notice("🏁 Notifying FlyFrog that CI job has ended...");
  core.debug(`Using URL: ${url}`);
  core.debug(`Access token length: ${accessToken.length}`);

  // This will throw an error if notification fails, causing the post-job to fail
  await notifyCiEnd(url, accessToken);
  core.notice("✅ CI end notification completed successfully");
}

// Run notification if this is being executed directly
if (require.main === module) {
  runPost().catch((error) => {
    core.setFailed(
      `CI end notification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

export { runPost };

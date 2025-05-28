import * as core from "@actions/core";
import { notifyCiEnd } from "./oidc";

/**
 * Post-job notification that runs after the main action to notify FlyFrog service
 */
async function runPost(): Promise<void> {
  try {
    // Get the URL and access token from the main action's state
    const url = core.getState("flyfrog-url");
    const accessToken = core.getState("flyfrog-access-token");

    if (!url) {
      core.debug("No FlyFrog URL found in state, skipping CI end notification");
      return;
    }

    if (!accessToken) {
      core.debug(
        "No access token found in state, skipping CI end notification",
      );
      return;
    }

    core.info("🏁 Notifying FlyFrog that CI job has ended...");
    await notifyCiEnd(url, accessToken);
    core.info("✅ CI end notification completed successfully");
  } catch (error) {
    // Don't fail the workflow if notification fails, just log a warning
    core.warning(
      `CI end notification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

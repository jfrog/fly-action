import * as core from "@actions/core";
import {
  STATE_FLYFROG_URL,
  STATE_FLYFROG_ACCESS_TOKEN,
  STATE_FLYFROG_PACKAGE_MANAGERS,
  STATE_FLYFROG_JOB_STATUS, // Import new constant
} from "./constants";
import * as http from "@actions/http-client";
import { OutgoingHttpHeaders } from "http";
import { EndCiRequest } from "./types"; // Import EndCiRequest

/**
 * Notifies the FlyFrog server that the CI run has ended (local function)
 * @param url The FlyFrog server URL
 * @param accessToken The access token for authentication
 * @param packageManagers Optional array of package managers used
 * @param status The status of the CI job
 */
async function notifyCiEnd(
  url: string,
  accessToken: string,
  packageManagers: string[] | undefined,
  status: string,
): Promise<void> {
  const client = new http.HttpClient("flyfrog-action");
  const endCiUrl = `${url}/flyfrog/api/v1/ci/end`;
  core.debug(`Notifying CI end at ${endCiUrl}`);

  const payload: EndCiRequest = {
    status,
  };
  if (packageManagers && packageManagers.length > 0) {
    payload.package_managers = packageManagers;
  }

  const headers: OutgoingHttpHeaders = {
    Authorization: `Bearer ${accessToken}`,
    [http.Headers.Accept]: http.MediaTypes.ApplicationJson,
    [http.Headers.ContentType]: http.MediaTypes.ApplicationJson,
  };

  core.debug(`FlyFrog CI end notification URL: ${endCiUrl}`);
  core.debug(`FlyFrog CI end notification payload: ${JSON.stringify(payload)}`);

  const rawResponse = await client.post(
    endCiUrl,
    JSON.stringify(payload),
    headers,
  );
  const body = await rawResponse.readBody();

  core.debug(
    `FlyFrog CI end notification response headers: ${JSON.stringify(
      rawResponse.message.headers,
    )}`,
  );

  if (rawResponse.message.statusCode === http.HttpCodes.OK) {
    core.debug(`FlyFrog CI end notification succeeded, body: ${body}`);
  } else {
    core.error(
      `FlyFrog CI end notification failed ${rawResponse.message.statusCode}, body: ${body}`,
    );
    throw new Error(
      `FlyFrog CI end notification failed ${rawResponse.message.statusCode}: ${body}`,
    );
  }
}

/**
 * Post-job notification that runs after the main action to notify FlyFrog service
 * Will fail the workflow if the CI end notification fails
 */
async function runPost(): Promise<void> {
  const url = core.getState(STATE_FLYFROG_URL);
  const accessToken = core.getState(STATE_FLYFROG_ACCESS_TOKEN);
  const packageManagersRaw = core.getState(STATE_FLYFROG_PACKAGE_MANAGERS);
  // Prefer state, then env var, then default
  const status =
    core.getState(STATE_FLYFROG_JOB_STATUS) ||
    process.env.JOB_STATUS ||
    "unknown";

  let packageManagers: string[] | undefined;
  if (packageManagersRaw) {
    try {
      packageManagers = JSON.parse(packageManagersRaw);
    } catch (e) {
      core.warning(
        `Failed to parse package managers from state: ${packageManagersRaw}. Sending without package managers. Error: ${e instanceof Error ? e.message : String(e)}`,
      );
      packageManagers = undefined;
    }
  }

  if (!url) {
    core.debug("No FlyFrog URL found in state, skipping CI end notification");
    return;
  }

  if (!accessToken) {
    core.debug("No access token found in state, skipping CI end notification");
    return;
  }

  core.info("🏁 Notifying FlyFrog that CI job has ended...");
  core.debug(`Using URL: ${url}`);
  core.debug(`Access token length: ${accessToken.length}`);
  core.debug(`Package managers: ${packageManagersRaw}`);
  core.debug(`Job status: ${status}`);

  await notifyCiEnd(url, accessToken, packageManagers, status); // Pass packageManagers and status
  core.info("✅ CI end notification completed successfully");
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

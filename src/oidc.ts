import * as core from "@actions/core";
import * as http from "@actions/http-client";
import {
  OidcAuthResult,
  FlyFrogOidcRequest,
  FlyFrogOidcResponse,
} from "./types";
import { OutgoingHttpHeaders } from "http";

// Represents the JSON body of the token exchange response
type TokenJson = { access_token?: string; [key: string]: unknown };

/**
 * Gets an OIDC token from the GitHub Actions runtime
 * @returns The OIDC token or undefined if the request failed
 */
export async function getIDToken(): Promise<string | undefined> {
  try {
    core.debug("Fetching OIDC token from GitHub");
    return await core.getIDToken();
  } catch (error) {
    core.warning(
      `Failed to get OIDC token: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * Extracts the username from a JWT token's sub claim
 * @param token The JWT token string
 * @returns The extracted username or undefined if parsing fails
 */
export function extractUserFromToken(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3)
      throw new Error("Unable to extract user from OIDC token");
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    if (payload.sub) {
      const sub: string = payload.sub;
      return sub.includes("/") ? sub.substring(sub.lastIndexOf("/") + 1) : sub;
    }
  } catch {
    core.warning("Failed to parse user from OIDC token");
    return undefined;
  }
}

/**
 * Performs full OIDC authentication with FlyFrog, returning the CLI user and access token
 * @param url The FlyFrog server URL
 */
export async function authenticateOidc(url: string): Promise<OidcAuthResult> {
  const idToken = await getIDToken();
  if (!idToken) throw new Error("Failed to obtain OIDC token");
  // Mask the raw ID token in logs
  core.setSecret(idToken);

  const user = extractUserFromToken(idToken);
  if (!user) throw new Error("Failed to extract user from OIDC token");

  const client = new http.HttpClient("flyfrog-action");
  const oidcUrl = `${url}/flyfrog/api/v1/ci/start-oidc`;
  core.debug(`Authenticating with FlyFrog OIDC at ${oidcUrl}`);

  // Build the FlyFrog OIDC request payload
  const payload: FlyFrogOidcRequest = {
    subject_token: idToken,
  };

  const headers: OutgoingHttpHeaders = {
    [http.Headers.ContentType]: http.MediaTypes.ApplicationJson,
    [http.Headers.Accept]: http.MediaTypes.ApplicationJson,
  };

  // Log OIDC details for debugging
  const maskedPayload = { subject_token: "***" };
  core.debug(`Authenticating with FlyFrog OIDC at ${oidcUrl}`);
  core.debug(`FlyFrog OIDC payload: ${JSON.stringify(maskedPayload)}`);

  const rawResponse = await client.post(
    oidcUrl,
    JSON.stringify(payload),
    headers,
  );
  const body = await rawResponse.readBody();
  // Parse JSON to mask access_token and register secret
  let parsedJson: TokenJson;
  try {
    parsedJson = JSON.parse(body);
    if (parsedJson.access_token) {
      core.setSecret(parsedJson.access_token);
    }
  } catch {
    parsedJson = {};
  }
  const maskedResponse = parsedJson.access_token
    ? { ...parsedJson, access_token: "***" }
    : parsedJson;
  // Log response details
  core.debug(
    `FlyFrog OIDC response headers: ${JSON.stringify(
      rawResponse.message.headers,
    )}`,
  );
  // Log success or error and throw on non-success status
  if (
    rawResponse.message.statusCode === http.HttpCodes.OK ||
    rawResponse.message.statusCode === 201
  ) {
    core.debug(`FlyFrog OIDC authentication successful`);
    core.debug(`FlyFrog OIDC response body: ${JSON.stringify(maskedResponse)}`);
  } else {
    core.error(
      `FlyFrog OIDC failed ${rawResponse.message.statusCode}, body: ${JSON.stringify(
        maskedResponse,
      )}`,
    );
    throw new Error(
      `FlyFrog OIDC failed ${rawResponse.message.statusCode}: ${body}`,
    );
  }
  const parsed = parsedJson as FlyFrogOidcResponse;
  if (!parsed || !parsed.access_token) {
    throw new Error(
      `OIDC response did not contain an access token, body: ${body}`,
    );
  }
  const accessToken = parsed.access_token;
  return { user, accessToken };
}

/**
 * Notifies the FlyFrog server that the CI run has ended
 * @param url The FlyFrog server URL
 * @param accessToken The access token for authentication
 */
export async function notifyCiEnd(
  url: string,
  accessToken: string,
): Promise<void> {
  const client = new http.HttpClient("flyfrog-action");
  const endCiUrl = `${url}/flyfrog/api/v1/ci/end`;
  core.debug(`Notifying CI end at ${endCiUrl}`);

  const headers: OutgoingHttpHeaders = {
    Authorization: `Bearer ${accessToken}`,
    [http.Headers.Accept]: http.MediaTypes.ApplicationJson,
  };

  core.debug(`FlyFrog CI end notification URL: ${endCiUrl}`);

  const rawResponse = await client.post(endCiUrl, "", headers);
  const body = await rawResponse.readBody();

  // Log response details
  core.debug(
    `FlyFrog CI end notification response headers: ${JSON.stringify(
      rawResponse.message.headers,
    )}`,
  );

  // Log success or error and throw on non-200
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

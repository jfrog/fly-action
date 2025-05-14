import * as core from "@actions/core";
import * as http from "@actions/http-client";
import {
  OidcAuthResult,
  TokenExchangeRequest,
  TokenExchangeResponse,
  OIDC_GRANT_TYPE,
  OIDC_ID_TOKEN_TYPE,
  OIDC_PROVIDER_NAME,
} from "./types";
import { OutgoingHttpHeaders } from "http";

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
 * Performs full OIDC authentication and token exchange, returning the CLI user and access token
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
  const tokenExchangeUrl = `${url}/access/api/v1/oidc/token`;
  core.debug(`Exchanging OIDC token at ${tokenExchangeUrl}`);

  // Build the token exchange request payload
  const payload: TokenExchangeRequest = {
    grant_type: OIDC_GRANT_TYPE,
    subject_token_type: OIDC_ID_TOKEN_TYPE,
    subject_token: idToken,
    provider_name: OIDC_PROVIDER_NAME,
  };

  const headers: OutgoingHttpHeaders = {
    [http.Headers.ContentType]: http.MediaTypes.ApplicationJson,
    [http.Headers.Accept]: http.MediaTypes.ApplicationJson,
  };

  // Log token exchange details (always visible)
  const maskedPayload = { ...payload, subject_token: "***" };
  core.info(`Token exchange URL: ${tokenExchangeUrl}`);
  core.info(`Token exchange payload: ${JSON.stringify(maskedPayload)}`);

  const rawResponse = await client.post(
    tokenExchangeUrl,
    JSON.stringify(payload),
    headers,
  );
  const body = await rawResponse.readBody();
  // Parse JSON to mask access_token and register secret
  let parsedJson: any;
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
  core.info(
    `Token exchange response headers: ${JSON.stringify(
      rawResponse.message.headers,
    )}`
  );
  // Log success or error and throw on non-200
  if (rawResponse.message.statusCode === http.HttpCodes.OK) {
    core.info(
      `Token exchange succeeded, body: ${JSON.stringify(maskedResponse)}`
    );
  } else {
    core.error(
      `Token exchange failed ${rawResponse.message.statusCode}, body: ${JSON.stringify(
        maskedResponse
      )}`
    );
    throw new Error(
      `Token exchange failed ${rawResponse.message.statusCode}: ${body}`
    );
  }
  const parsed = parsedJson as TokenExchangeResponse;
  if (!parsed || !parsed.access_token) {
    throw new Error(
      `Token response did not contain an access token, body: ${body}`,
    );
  }
  const accessToken = parsed.access_token;
  return { user, accessToken };
}

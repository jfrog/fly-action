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

  const user = extractUserFromToken(idToken);
  if (!user) throw new Error("Failed to extract user from OIDC token");

  const client = new http.HttpClient("flyfrog-action");
  const tokenExchangeUrl = `${url}/api/v1/oidc/token`;
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

  // Exchange ID token for FlyFrog access token in one step
  const response = await client.postJson<TokenExchangeResponse>(
    tokenExchangeUrl,
    payload,
    headers,
  );
  if (response.statusCode !== http.HttpCodes.OK) {
    // Use direct result to avoid JSON.stringify adding extra quotes
    throw new Error(
      `Token exchange failed ${response.statusCode}: ${String(response.result)}`,
    );
  }

  // Ensure result is not null before accessing the access_token field
  const result = response.result;
  if (!result) {
    throw new Error("Token exchange returned empty response body");
  }
  const accessToken = result.access_token;
  if (!accessToken) {
    throw new Error("Token response did not contain an access token");
  }

  return { user, accessToken };
}

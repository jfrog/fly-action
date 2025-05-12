import * as core from "@actions/core";
import * as http from "@actions/http-client";
import { FlyFrogCredentials } from "./types";

const DEFAULT_OIDC_PROVIDER_NAME = "flyfrog-action";

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
 * Exchanges a GitHub OIDC token for a FlyFrog access token
 * @param credentials The current FlyFrog credentials
 * @param idToken The OIDC token from GitHub
 * @param providerName The OIDC provider name configured in FlyFrog
 * @returns Updated credentials with access token
 */
export async function exchangeTokenForFlyFrogToken(
  credentials: FlyFrogCredentials,
  idToken: string,
  providerName: string,
): Promise<FlyFrogCredentials> {
  if (!credentials.url) throw new Error("FlyFrog URL is required");
  const client = new http.HttpClient("setup-flyfrog-action");

  const tokenExchangeUrl = `${credentials.url}/api/v1/oidc/token`;

  // Debug the token exchange URL
  core.debug(`Exchanging OIDC token at ${tokenExchangeUrl}`);

  const data = JSON.stringify({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    subject_token: idToken,
    provider_name: providerName,
  });

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const response = await client.post(tokenExchangeUrl, data, headers);
    const responseBody = await response.readBody();

    if (response.message.statusCode !== 200) {
      throw new Error(
        `Token exchange failed with status ${response.message.statusCode}: ${responseBody}`,
      );
    }

    try {
      const tokenResponse = JSON.parse(responseBody);
      if (tokenResponse.access_token) {
        // Return updated credentials with the exchanged access token
        return {
          ...credentials,
          accessToken: tokenResponse.access_token,
        };
      } else {
        throw new Error("Token response did not contain an access token");
      }
    } catch (error) {
      throw new Error(
        `Failed to parse token response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } catch (error) {
    throw new Error(
      `Token exchange request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
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
export async function authenticateOidc(
  url: string,
): Promise<{ user: string; accessToken: string }> {
  const idToken = await getIDToken();
  if (!idToken) throw new Error("Failed to obtain OIDC token");

  const user = extractUserFromToken(idToken);
  if (!user) throw new Error("Failed to extract user from OIDC token");

  let credentials: FlyFrogCredentials = { url };
  credentials = await exchangeTokenForFlyFrogToken(
    credentials,
    idToken,
    DEFAULT_OIDC_PROVIDER_NAME,
  );
  if (!credentials.accessToken)
    throw new Error("Token exchange did not return an access token");

  return { user, accessToken: credentials.accessToken };
}

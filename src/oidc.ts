// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as http from "@actions/http-client";
import { OidcAuthResult, FlyOidcRequest, FlyOidcResponse } from "./types";
import { OutgoingHttpHeaders } from "http";
import { createHttpClient, getErrorMessage, truncate } from "./utils";

// Represents the JSON body of the token exchange response
type TokenJson = { access_token?: string; [key: string]: unknown };

/**
 * Gets an OIDC token from the GitHub Actions runtime
 * @returns The OIDC token or undefined if the request failed
 */
async function getIDToken(): Promise<string | undefined> {
  try {
    core.debug("Fetching OIDC token from GitHub");
    return await core.getIDToken();
  } catch (error) {
    core.warning(`Failed to get OIDC token: ${getErrorMessage(error)}`);
    return undefined;
  }
}

/**
 * Performs full OIDC authentication with Fly, returning the access token
 * @param url The Fly server URL
 */
export async function authenticateOidc(url: string): Promise<OidcAuthResult> {
  const idToken = await getIDToken();
  if (!idToken) throw new Error("Failed to obtain OIDC token");
  // Mask the raw ID token in logs
  core.setSecret(idToken);

  const client = createHttpClient();
  const oidcUrl = `${url}/fly/api/v1/ci/start-oidc`;
  core.debug(`Authenticating with Fly OIDC at ${oidcUrl}`);

  // Build the Fly OIDC request payload
  const payload: FlyOidcRequest = {
    subject_token: idToken,
  };

  const headers: OutgoingHttpHeaders = {
    [http.Headers.ContentType]: http.MediaTypes.ApplicationJson,
    [http.Headers.Accept]: http.MediaTypes.ApplicationJson,
  };

  const rawResponse = await client.post(
    oidcUrl,
    JSON.stringify(payload),
    headers,
  );
  const body = await rawResponse.readBody();
  let parsedJson: TokenJson;
  let jsonParseFailed = false;
  try {
    parsedJson = JSON.parse(body);
    if (parsedJson.access_token) {
      core.setSecret(parsedJson.access_token);
    }
  } catch {
    parsedJson = {};
    jsonParseFailed = true;
  }
  const maskedResponse = parsedJson.access_token
    ? { ...parsedJson, access_token: "***" }
    : parsedJson;
  const statusCode = rawResponse.message.statusCode;
  const HTTP_CREATED = 201; // not in HttpCodes enum
  const isSuccess =
    statusCode === http.HttpCodes.OK || statusCode === HTTP_CREATED;

  core.debug(
    `OIDC response headers: ${JSON.stringify(rawResponse.message.headers)}`,
  );

  if (isSuccess) {
    core.debug(`OIDC authentication successful`);
    core.debug(`OIDC response body: ${JSON.stringify(maskedResponse)}`);
  } else {
    const server =
      rawResponse.message.headers["server"] ||
      rawResponse.message.headers["x-cache"] ||
      "unknown";
    core.error(`OIDC failed ${statusCode} from server: ${server}`);

    if (jsonParseFailed) {
      core.error(
        `Response is not JSON — possible infrastructure error page. Raw body: ${truncate(body, 500)}`,
      );
    } else {
      core.error(`Response body: ${JSON.stringify(maskedResponse)}`);
    }

    if (
      statusCode === http.HttpCodes.Forbidden &&
      (jsonParseFailed || Object.keys(parsedJson).length === 0)
    ) {
      core.error(
        "Hint: a 403 with a non-JSON body usually means a CDN/WAF blocked the request " +
          "before it reached the Fly service. If you are using self-hosted runners, " +
          "ensure their outbound IP is allowlisted. " +
          "Contact JFrog support if the issue persists.",
      );
    }

    throw new Error(
      `OIDC failed ${statusCode}: ${jsonParseFailed ? truncate(body, 200) : JSON.stringify(maskedResponse)}`,
    );
  }
  const parsed = parsedJson as Partial<FlyOidcResponse>;
  if (!parsed || !parsed.access_token) {
    throw new Error(
      `OIDC response did not contain an access token, body: ${JSON.stringify(maskedResponse)}`,
    );
  }
  if (!parsed.fly_tenant_url) {
    throw new Error(
      `OIDC response did not contain fly_tenant_url — server may not support tenant resolution yet, body: ${JSON.stringify(maskedResponse)}`,
    );
  }
  return {
    accessToken: parsed.access_token,
    flyTenantUrl: parsed.fly_tenant_url,
  };
}

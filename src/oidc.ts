// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as http from "@actions/http-client";
import { OidcAuthResult, FlyOidcRequest, FlyOidcResponse } from "./types";
import { OutgoingHttpHeaders } from "http";
import { createHttpClient, getErrorMessage, truncate } from "./utils";
import { executeWithRetry, isTransientHttpError } from "./retry";

// Represents the JSON body of the token exchange response
type TokenJson = { access_token?: string; [key: string]: unknown };

// GitHub injects this env var only when the job has `id-token: write`. Its
// absence is a deterministic permission problem; its presence means any token
// fetch failure is a transient runtime/OIDC-provider hiccup worth retrying.
const ID_TOKEN_REQUEST_URL_ENV = "ACTIONS_ID_TOKEN_REQUEST_URL";

const MISSING_PERMISSION_HINT =
  "This almost always means the job is missing the 'id-token: write' permission, " +
  "which is required for Fly to authenticate via GitHub OIDC.\n" +
  "Fix: add the following to your workflow (at the workflow or job level):\n" +
  "  permissions:\n" +
  "    id-token: write\n" +
  "    contents: read\n" +
  "See https://docs.github.com/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect#adding-permissions-settings for details.";

/**
 * Gets an OIDC token from the GitHub Actions runtime.
 *
 * Distinguishes two failure modes that the action used to conflate:
 *  - Missing `id-token: write` permission — deterministic, not retryable.
 *    Detected up front via the absence of `ACTIONS_ID_TOKEN_REQUEST_URL`,
 *    which GitHub only injects when the permission is granted.
 *  - Transient OIDC-provider hiccup (network blip, 5xx, socket hang up) —
 *    when the permission IS present, the token fetch is retried with backoff
 *    instead of failing the whole job on the first attempt.
 */
async function getIDToken(): Promise<string> {
  core.debug("Fetching OIDC token from GitHub");

  // No OIDC runtime injected → the job lacks `id-token: write`. Retrying cannot
  // help, so fail fast with the actionable permission hint.
  if (!process.env[ID_TOKEN_REQUEST_URL_ENV]) {
    throw new Error(
      `Failed to get OIDC token: ${ID_TOKEN_REQUEST_URL_ENV} is not set.\n` +
        MISSING_PERMISSION_HINT,
    );
  }

  // Permission is granted, so any failure here is a transient GitHub OIDC
  // issue. Retry with backoff rather than aborting the job on a one-off blip.
  return executeWithRetry(
    async () => {
      try {
        return await core.getIDToken();
      } catch (error) {
        const wrapped = new Error(
          `Failed to get OIDC token from GitHub: ${getErrorMessage(error)}`,
        );
        (wrapped as Error & { cause?: unknown }).cause = error;
        throw wrapped;
      }
    },
    {
      isRetryable: () => true,
      label: "GitHub OIDC token",
    },
  );
}

/**
 * Performs full OIDC authentication with Fly, returning the access token
 * @param url The Fly server URL
 */
export async function authenticateOidc(url: string): Promise<OidcAuthResult> {
  const idToken = await getIDToken();
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

  function extractStatusCode(err: Error): number | undefined {
    const match = err.message.match(/\bfailed (\d{3})\b/);
    return match ? parseInt(match[1], 10) : undefined;
  }

  return executeWithRetry(
    async () => {
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
      const isSuccess = statusCode === http.HttpCodes.OK || statusCode === 201;

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
        username: parsed.username,
      };
    },
    {
      isRetryable: (err) =>
        isTransientHttpError(err) ||
        isTransientHttpError(null, extractStatusCode(err)),
      label: "OIDC auth",
    },
  );
}

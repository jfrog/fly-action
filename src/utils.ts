// Copyright (c) JFrog Ltd. (2025)

import { HttpClient } from "@actions/http-client";
import { MAX_ERROR_OUTPUT_LENGTH } from "./constants";

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Default timeout for HTTP requests in milliseconds.
 * Prevents requests from hanging indefinitely.
 */
/**
 * Truncates a string to MAX_ERROR_OUTPUT_LENGTH to prevent sensitive data
 * (environment variables, internal URLs) from leaking into log output.
 */
export function truncate(s: string, max = MAX_ERROR_OUTPUT_LENGTH): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "… (truncated)";
}

export const DEFAULT_HTTP_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Creates a configured HTTP client with sensible defaults.
 * Includes a configurable timeout to prevent hanging requests.
 *
 * @param userAgent - User agent string for the HTTP client (defaults to "fly-action")
 * @param timeoutMs - Socket timeout in milliseconds (defaults to DEFAULT_HTTP_TIMEOUT_MS)
 * @returns Configured HttpClient instance
 *
 * @example
 * const client = createHttpClient();
 * const response = await client.get("https://api.example.com");
 *
 * @example
 * const client = createHttpClient("my-custom-agent", 60000);
 */
export function createHttpClient(
  userAgent = "fly-action",
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
): HttpClient {
  return new HttpClient(userAgent, undefined, {
    socketTimeout: timeoutMs,
  });
}

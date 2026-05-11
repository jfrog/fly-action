// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import { getErrorMessage } from "./utils";

// POSIX error codes set on Node.js Error.code for network failures
const TRANSIENT_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
]);

// HTTP status codes that indicate a transient server-side issue.
// Matches @actions/tool-cache's retryable set (5xx + 408 + 429).
const TRANSIENT_HTTP_CODES = new Set([408, 429, 500, 502, 503, 504]);

// Fallback message patterns for errors without a .code property
const TRANSIENT_MESSAGE_PATTERNS = ["socket hang up", "socket timeout"];

// Stderr patterns from Go process exits that indicate transient network issues
const TRANSIENT_PROCESS_PATTERNS = [
  "timeout",
  "deadline exceeded",
  "connection refused",
  "connection reset",
  "unreachable",
  "i/o timeout",
  "login failed",
];

/**
 * Returns true if the HTTP error is transient (worth retrying).
 * Classification priority: error.code (POSIX) > HTTP status > message fallback.
 */
export function isTransientHttpError(
  err: unknown,
  statusCode?: number,
): boolean {
  if (statusCode !== undefined && TRANSIENT_HTTP_CODES.has(statusCode))
    return true;

  if (err && typeof err === "object" && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && TRANSIENT_ERROR_CODES.has(code)) return true;
  }

  const msg = getErrorMessage(err).toLowerCase();
  return TRANSIENT_MESSAGE_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Returns true if process stderr indicates a transient network failure.
 * Used to classify non-zero exit codes from `fly setup` (Go binary).
 */
export function isTransientProcessError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return TRANSIENT_PROCESS_PATTERNS.some((p) => lower.includes(p));
}

export interface RetryOptions {
  /** Classifier: return true to retry, false to fail immediately */
  isRetryable: (err: Error) => boolean;
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms, doubles each attempt (default: 2000) */
  initialDelayMs?: number;
  /** Label for log messages (e.g. "OIDC auth") */
  label?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes an async action with retry and exponential backoff.
 * Refactored from post.ts postWithRetry() to be reusable across call sites.
 *
 * If `isRetryable` returns false for an error, throws immediately.
 * Network errors (thrown exceptions) and transient HTTP responses
 * are retried up to maxAttempts times.
 */
export async function executeWithRetry<T>(
  action: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 2000;
  const label = options.label ?? "request";

  let lastError: Error = new Error(
    `${label} failed after ${maxAttempts} attempts`,
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action();
    } catch (error: unknown) {
      lastError =
        error instanceof Error ? error : new Error(getErrorMessage(error));

      if (!options.isRetryable(lastError)) {
        throw lastError;
      }
    }

    if (attempt < maxAttempts) {
      const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
      core.warning(
        `${label} failed (attempt ${attempt}/${maxAttempts}): ${lastError.message}. ` +
          `Retrying in ${delayMs}ms...`,
      );
      await sleep(delayMs);
    } else {
      core.error(
        `${label} failed after ${maxAttempts} attempts: ${lastError.message}`,
      );
    }
  }

  throw lastError;
}

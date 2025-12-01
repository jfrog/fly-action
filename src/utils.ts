// Copyright (c) JFrog Ltd. (2025)

import { HttpClient } from "@actions/http-client";

/**
 * Utility functions for the fly-action project.
 * These are generic helpers that can be reused across different modules.
 */

/**
 * Represents a compiled file pattern for efficient matching.
 * Patterns starting with "*." are compiled to regex, others use exact string matching.
 */
export interface FileMatchPattern {
  /** Optional regex for wildcard patterns (e.g., "*.csproj" -> /^.*\.csproj$/i) */
  regex?: RegExp;
  /** Lowercase filename for exact matching or debugging */
  exactName: string;
}

/**
 * Converts a string or array to a normalized array.
 * Useful for handling parameters that can be either a single value or multiple values.
 *
 * @param value - A string or array of strings (including readonly arrays)
 * @returns An array of strings
 *
 * @example
 * normalizeToArray('file.txt') // ['file.txt']
 * normalizeToArray(['a.txt', 'b.txt']) // ['a.txt', 'b.txt']
 */
export function normalizeToArray(
  value: string | string[] | readonly string[],
): string[] {
  // Array.isArray doesn't narrow readonly arrays properly in TypeScript,
  // so we check for string first
  if (typeof value === "string") {
    return [value];
  }
  // value is now string[] | readonly string[]
  return [...value];
}

/**
 * Compiles a single file pattern into an optimized matcher.
 * Wildcard patterns (*.ext) are converted to regex for fast matching.
 * Exact filenames use simple string comparison.
 *
 * @param pattern - The file pattern to compile (e.g., "*.csproj" or "package.json")
 * @returns A compiled pattern with optional regex and normalized exact name
 *
 * @example
 * compileFilePattern('*.csproj')
 * // { regex: /^.*\.csproj$/i, exactName: '*.csproj' }
 *
 * compileFilePattern('package.json')
 * // { exactName: 'package.json' }
 */
export function compileFilePattern(pattern: string): FileMatchPattern {
  const normalizedPattern = pattern.toLowerCase();

  if (normalizedPattern.startsWith("*.")) {
    // Wildcard pattern: compile to regex for fast matching
    const extension = normalizedPattern.substring(1); // includes the dot
    return {
      regex: new RegExp(`^.*\\${extension}$`, "i"),
      exactName: normalizedPattern,
    };
  }

  // Exact filename match
  return {
    exactName: normalizedPattern,
  };
}

/**
 * Extracts a readable error message from an unknown error type.
 * Safely handles Error objects, strings, and other types.
 *
 * @param error - The error to extract a message from
 * @returns A string representation of the error
 *
 * @example
 * getErrorMessage(new Error('Failed')) // 'Failed'
 * getErrorMessage('Something went wrong') // 'Something went wrong'
 * getErrorMessage({ code: 404 }) // '[object Object]'
 */
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
export const DEFAULT_HTTP_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Creates a configured HTTP client with sensible defaults.
 * Includes a 30-second timeout to prevent hanging requests.
 *
 * @param userAgent - User agent string for the HTTP client (defaults to "fly-action")
 * @returns Configured HttpClient instance
 *
 * @example
 * const client = createHttpClient();
 * const response = await client.get("https://api.example.com");
 *
 * @example
 * const client = createHttpClient("my-custom-agent");
 */
export function createHttpClient(userAgent = "fly-action"): HttpClient {
  return new HttpClient(userAgent, undefined, {
    socketTimeout: DEFAULT_HTTP_TIMEOUT_MS,
  });
}

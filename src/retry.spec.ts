// Copyright (c) JFrog Ltd. (2025)

import { vi } from "vitest";
import {
  isTransientHttpError,
  isTransientProcessError,
  executeWithRetry,
} from "./retry";

vi.mock("@actions/core", () => ({
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

describe("isTransientHttpError", () => {
  describe("HTTP status codes", () => {
    it.each([408, 429, 500, 502, 503, 504])(
      "returns true for transient status %d",
      (code) => {
        expect(isTransientHttpError(null, code)).toBe(true);
      },
    );

    it.each([200, 201, 400, 401, 403, 404, 409, 422])(
      "returns false for permanent status %d",
      (code) => {
        expect(isTransientHttpError(null, code)).toBe(false);
      },
    );

    it("returns false when statusCode is undefined", () => {
      expect(isTransientHttpError(null, undefined)).toBe(false);
    });
  });

  describe("POSIX error codes", () => {
    it.each([
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EPIPE",
      "EAI_AGAIN",
    ])("returns true for error.code = %s", (code) => {
      const err = new Error("network failure");
      (err as NodeJS.ErrnoException).code = code;
      expect(isTransientHttpError(err)).toBe(true);
    });

    it("returns false for non-transient error codes", () => {
      const err = new Error("bad request");
      (err as NodeJS.ErrnoException).code = "ERR_INVALID_URL";
      expect(isTransientHttpError(err)).toBe(false);
    });
  });

  describe("message fallback patterns", () => {
    it.each(["socket hang up", "socket timeout"])(
      'returns true for message containing "%s"',
      (pattern) => {
        expect(isTransientHttpError(new Error(`request: ${pattern}`))).toBe(
          true,
        );
      },
    );

    it("returns false for unrelated error messages", () => {
      expect(isTransientHttpError(new Error("Invalid JSON response"))).toBe(
        false,
      );
    });
  });

  describe("edge cases", () => {
    it("returns false for null error with no status code", () => {
      expect(isTransientHttpError(null)).toBe(false);
    });

    it("returns false for undefined error", () => {
      expect(isTransientHttpError(undefined)).toBe(false);
    });

    it("returns false for string error", () => {
      expect(isTransientHttpError("some error")).toBe(false);
    });

    it("prefers status code over error code", () => {
      const err = new Error("timeout");
      (err as NodeJS.ErrnoException).code = "ETIMEDOUT";
      expect(isTransientHttpError(err, 403)).toBe(true);
    });
  });
});

describe("isTransientProcessError", () => {
  it.each([
    "context deadline exceeded",
    "connection refused",
    "connection reset by peer",
    "network is unreachable",
    "i/o timeout",
    "Client.Timeout exceeded while awaiting headers",
    "docker login failed for: flyjfrog.jfrog.io",
    "failed to login to container registry: login failed",
  ])('returns true for stderr containing "%s"', (stderr) => {
    expect(isTransientProcessError(stderr)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isTransientProcessError("CONTEXT DEADLINE EXCEEDED")).toBe(true);
  });

  it.each([
    "invalid credentials",
    "permission denied",
    "unsupported package manager",
    "failed to parse config",
    "",
  ])('returns false for stderr "%s"', (stderr) => {
    expect(isTransientProcessError(stderr)).toBe(false);
  });
});

describe("executeWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first success", async () => {
    const action = vi.fn().mockResolvedValue("ok");
    const result = await executeWithRetry(action, {
      isRetryable: () => true,
    });
    expect(result).toBe("ok");
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error and succeeds", async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValue("ok");

    const promise = executeWithRetry(action, {
      isRetryable: () => true,
      initialDelayMs: 100,
      label: "test",
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on non-retryable error", async () => {
    const action = vi.fn().mockRejectedValue(new Error("401 Unauthorized"));

    await expect(
      executeWithRetry(action, {
        isRetryable: () => false,
      }),
    ).rejects.toThrow("401 Unauthorized");
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all attempts", async () => {
    vi.useRealTimers();
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"));

    await expect(
      executeWithRetry(action, {
        isRetryable: () => true,
        maxAttempts: 3,
        initialDelayMs: 1,
        label: "test",
      }),
    ).rejects.toThrow("timeout");
    expect(action).toHaveBeenCalledTimes(3);
    vi.useFakeTimers();
  });

  it("uses exponential backoff", async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("ok");

    const promise = executeWithRetry(action, {
      isRetryable: () => true,
      maxAttempts: 3,
      initialDelayMs: 1000,
    });

    // First retry: 1000ms * 2^0 = 1000ms
    expect(action).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(action).toHaveBeenCalledTimes(2);

    // Second retry: 1000ms * 2^1 = 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe("ok");
    expect(action).toHaveBeenCalledTimes(3);
  });

  it("converts non-Error throws to Error", async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce("string error")
      .mockResolvedValue("ok");

    const promise = executeWithRetry(action, {
      isRetryable: () => true,
      initialDelayMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("ok");
  });

  it("defaults to 3 attempts", async () => {
    vi.useRealTimers();
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"));

    await expect(
      executeWithRetry(action, {
        isRetryable: () => true,
        initialDelayMs: 1,
      }),
    ).rejects.toThrow("fail");
    expect(action).toHaveBeenCalledTimes(3);
    vi.useFakeTimers();
  });
});

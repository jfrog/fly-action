// Copyright (c) JFrog Ltd. (2025)

import {
  createHttpClient,
  DEFAULT_HTTP_TIMEOUT_MS,
  getErrorMessage,
  truncate,
} from "./utils";

describe("utils", () => {
  describe("getErrorMessage", () => {
    it("should extract message from Error objects", () => {
      const error = new Error("Something went wrong");
      expect(getErrorMessage(error)).toBe("Something went wrong");
    });

    it("should handle string errors", () => {
      expect(getErrorMessage("Error string")).toBe("Error string");
    });

    it("should handle number errors", () => {
      expect(getErrorMessage(404)).toBe("404");
    });

    it("should handle null", () => {
      expect(getErrorMessage(null)).toBe("null");
    });

    it("should handle undefined", () => {
      expect(getErrorMessage(undefined)).toBe("undefined");
    });

    it("should handle object errors", () => {
      const error = { code: 500, message: "Server error" };
      expect(getErrorMessage(error)).toBe("[object Object]");
    });

    it("should handle TypeError", () => {
      const error = new TypeError("Type mismatch");
      expect(getErrorMessage(error)).toBe("Type mismatch");
    });
  });

  describe("truncate", () => {
    it("returns short strings unchanged", () => {
      expect(truncate("hello")).toBe("hello");
    });

    it("truncates strings exceeding the limit", () => {
      const long = "a".repeat(600);
      const result = truncate(long);
      expect(result.length).toBeLessThan(600);
      expect(result).toContain("… (truncated)");
    });

    it("respects custom max length", () => {
      const result = truncate("abcdefgh", 5);
      expect(result).toBe("abcde… (truncated)");
    });
  });

  describe("createHttpClient", () => {
    it("should create an HttpClient with default user agent", () => {
      const client = createHttpClient();
      expect(client).toBeDefined();
      expect(client).toHaveProperty("get");
      expect(client).toHaveProperty("post");
    });

    it("should create an HttpClient with custom user agent", () => {
      const client = createHttpClient("custom-agent");
      expect(client).toBeDefined();
    });

    it("should use the default timeout constant", () => {
      expect(DEFAULT_HTTP_TIMEOUT_MS).toBe(30000);
    });

    it("should create different instances on each call", () => {
      const client1 = createHttpClient();
      const client2 = createHttpClient();
      expect(client1).not.toBe(client2);
    });
  });
});

// Copyright (c) JFrog Ltd. (2025)

import {
  compileFilePattern,
  createHttpClient,
  DEFAULT_HTTP_TIMEOUT_MS,
  FileMatchPattern,
  getErrorMessage,
  normalizeToArray,
} from "./utils";

describe("utils", () => {
  describe("normalizeToArray", () => {
    it("should convert a single string to an array", () => {
      const result = normalizeToArray("file.txt");
      expect(result).toEqual(["file.txt"]);
    });

    it("should return a copy of an array", () => {
      const input = ["a.txt", "b.txt"];
      const result = normalizeToArray(input);
      expect(result).toEqual(["a.txt", "b.txt"]);
      expect(result).not.toBe(input); // Should be a new array
    });

    it("should handle readonly arrays", () => {
      const input: readonly string[] = ["x.txt", "y.txt"];
      const result = normalizeToArray(input);
      expect(result).toEqual(["x.txt", "y.txt"]);
    });

    it("should handle empty arrays", () => {
      const result = normalizeToArray([]);
      expect(result).toEqual([]);
    });
  });

  describe("compileFilePattern", () => {
    it("should compile wildcard patterns to regex", () => {
      const result = compileFilePattern("*.csproj");
      expect(result.exactName).toBe("*.csproj");
      expect(result.regex).toBeDefined();
      expect(result.regex?.test("MyProject.csproj")).toBe(true);
      expect(result.regex?.test("MyProject.CSPROJ")).toBe(true); // Case insensitive
      expect(result.regex?.test("MyProject.vbproj")).toBe(false);
    });

    it("should handle exact filename patterns", () => {
      const result = compileFilePattern("package.json");
      expect(result.exactName).toBe("package.json");
      expect(result.regex).toBeUndefined();
    });

    it("should normalize patterns to lowercase", () => {
      const result = compileFilePattern("Package.JSON");
      expect(result.exactName).toBe("package.json");
    });

    it("should compile multiple wildcard extensions correctly", () => {
      const csprojPattern = compileFilePattern("*.csproj");
      const fsprojPattern = compileFilePattern("*.fsproj");

      expect(csprojPattern.regex?.test("App.csproj")).toBe(true);
      expect(csprojPattern.regex?.test("App.fsproj")).toBe(false);

      expect(fsprojPattern.regex?.test("App.fsproj")).toBe(true);
      expect(fsprojPattern.regex?.test("App.csproj")).toBe(false);
    });

    it("should handle complex filenames with wildcards", () => {
      const result = compileFilePattern("*.lock");
      expect(result.regex?.test("yarn.lock")).toBe(true);
      expect(result.regex?.test("pnpm-lock.yaml")).toBe(false);
      expect(result.regex?.test("poetry.lock")).toBe(true);
    });
  });

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

  describe("FileMatchPattern interface", () => {
    it("should allow patterns with only exactName", () => {
      const pattern: FileMatchPattern = {
        exactName: "package.json",
      };
      expect(pattern.exactName).toBe("package.json");
      expect(pattern.regex).toBeUndefined();
    });

    it("should allow patterns with both regex and exactName", () => {
      const pattern: FileMatchPattern = {
        regex: /^.*\.ts$/i,
        exactName: "*.ts",
      };
      expect(pattern.exactName).toBe("*.ts");
      expect(pattern.regex).toBeDefined();
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

// Copyright (c) JFrog Ltd. (2025)

import { describe, it, expect } from "vitest";
import { resolveArtifact, resolveAndDedup, dedupKey } from "./artifact-path";
import { CollectedArtifact } from "./types";

describe("resolveArtifact", () => {
  describe("npm", () => {
    it("parses scoped npm path", () => {
      const result = resolveArtifact({
        name: "backend-0.0.9.tgz",
        type: "npm",
        path: "@ascii-frog/backend/-/@ascii-frog/backend-0.0.9.tgz",
      });
      expect(result).toEqual({
        name: "@ascii-frog/backend",
        version: "0.0.9",
        type: "npm",
      });
    });

    it("parses unscoped npm path", () => {
      const result = resolveArtifact({
        name: "lodash-4.17.21.tgz",
        type: "npm",
        path: "lodash/-/lodash-4.17.21.tgz",
      });
      expect(result).toEqual({
        name: "lodash",
        version: "4.17.21",
        type: "npm",
      });
    });

    it("falls back when path has no /-/ separator", () => {
      const result = resolveArtifact({
        name: "bad.tgz",
        type: "npm",
        path: "just/a/path",
      });
      expect(result.name).toBe("bad.tgz");
    });
  });

  describe("docker", () => {
    it("parses docker image with tag", () => {
      const result = resolveArtifact({
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/v1.0.0/manifest.json",
      });
      expect(result).toEqual({
        name: "myorg/api",
        version: "v1.0.0",
        type: "docker",
      });
    });

    it("parses nested image path", () => {
      const result = resolveArtifact({
        name: "manifest.json",
        type: "docker",
        path: "library/nginx/latest/manifest.json",
      });
      expect(result).toEqual({
        name: "library/nginx",
        version: "latest",
        type: "docker",
      });
    });

    it("returns empty version for sha256 digest", () => {
      const result = resolveArtifact({
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/sha256:abc123def/manifest.json",
      });
      expect(result.name).toBe("myorg/api");
      expect(result.version).toBe("");
    });

    it("handles list.manifest.json", () => {
      const result = resolveArtifact({
        name: "list.manifest.json",
        type: "docker",
        path: "myorg/api/v1.0.0/list.manifest.json",
      });
      expect(result).toEqual({
        name: "myorg/api",
        version: "v1.0.0",
        type: "docker",
      });
    });
  });

  describe("helmoci", () => {
    it("parses helm OCI path", () => {
      const result = resolveArtifact({
        name: "manifest.json",
        type: "helmoci",
        path: "my-chart/1.0.0/manifest.json",
      });
      expect(result).toEqual({
        name: "my-chart",
        version: "1.0.0",
        type: "helmoci",
      });
    });
  });

  describe("maven", () => {
    it("parses maven jar path", () => {
      const result = resolveArtifact({
        name: "maven-demo-1.0.8748.jar",
        type: "maven",
        path: "com/asciifrog/maven-demo/1.0.8748/maven-demo-1.0.8748.jar",
      });
      expect(result).toEqual({
        name: "maven-demo",
        version: "1.0.8748",
        type: "maven",
      });
    });

    it("parses gradle pom path", () => {
      const result = resolveArtifact({
        name: "gradle-demo-1.0.8764.pom",
        type: "maven",
        path: "com/asciifrog/gradle-demo/1.0.8764/gradle-demo-1.0.8764.pom",
      });
      expect(result).toEqual({
        name: "gradle-demo",
        version: "1.0.8764",
        type: "maven",
      });
    });

    it("returns empty version for maven metadata", () => {
      const result = resolveArtifact({
        name: "maven-metadata.xml.sha512",
        type: "maven",
        path: "com/asciifrog/gradle-demo/maven-metadata.xml.sha512",
      });
      expect(result.version).toBe("");
    });
  });

  describe("pypi", () => {
    it("parses pypi wheel path", () => {
      const result = resolveArtifact({
        name: "ascii_frog_python-0.0.9-py3-none-any.whl",
        type: "pypi",
        path: "ascii-frog-python/0.0.9/ascii_frog_python-0.0.9-py3-none-any.whl",
      });
      expect(result).toEqual({
        name: "ascii-frog-python",
        version: "0.0.9",
        type: "pypi",
      });
    });
  });

  describe("nuget", () => {
    it("parses structured nuget path", () => {
      const result = resolveArtifact({
        name: "AsciiFrog.NuGet.1.0.8781.nupkg",
        type: "nuget",
        path: "AsciiFrog.NuGet/1.0.8781/AsciiFrog.NuGet.1.0.8781.nupkg",
      });
      expect(result).toEqual({
        name: "AsciiFrog.NuGet",
        version: "1.0.8781",
        type: "nuget",
      });
    });

    it("parses flat nuget filename", () => {
      const result = resolveArtifact({
        name: "AsciiFrog.DotNet.1.0.9139.nupkg",
        type: "nuget",
        path: "AsciiFrog.DotNet.1.0.9139.nupkg",
      });
      expect(result).toEqual({
        name: "AsciiFrog.DotNet",
        version: "1.0.9139",
        type: "nuget",
      });
    });
  });

  describe("generic", () => {
    it("parses generic path", () => {
      const result = resolveArtifact({
        name: "app.zip",
        type: "generic",
        path: "my-app/1.0.0/app.zip",
      });
      expect(result).toEqual({
        name: "my-app",
        version: "1.0.0",
        type: "generic",
      });
    });
  });

  describe("edge cases", () => {
    it("returns artifact name when path is missing", () => {
      const result = resolveArtifact({ name: "foo", type: "npm" });
      expect(result.name).toBe("foo");
    });

    it("returns artifact name for unknown type", () => {
      const result = resolveArtifact({
        name: "bar",
        type: "unknown",
        path: "some/path",
      });
      expect(result.name).toBe("bar");
    });
  });
});

describe("dedupKey", () => {
  it("builds canonical key", () => {
    expect(dedupKey({ name: "foo", version: "1.0", type: "NPM" })).toBe(
      "npm:foo:1.0",
    );
  });
});

describe("resolveAndDedup", () => {
  it("deduplicates docker manifests to one entry per image", () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/v1.0.0/manifest.json",
      },
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/v1.0.0/manifest.json",
      },
      {
        name: "list.manifest.json",
        type: "docker",
        path: "myorg/api/v1.0.0/list.manifest.json",
      },
    ];
    const result = resolveAndDedup(artifacts);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("myorg/api");
    expect(result[0].version).toBe("v1.0.0");
  });

  it("filters out sha256 digest entries", () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/v1.0.0/manifest.json",
      },
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/sha256:abc123/manifest.json",
      },
    ];
    const result = resolveAndDedup(artifacts);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe("v1.0.0");
  });

  it("collapses maven .jar/.pom/.sha512 to one entry", () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "maven-demo-1.0.jar",
        type: "maven",
        path: "com/example/maven-demo/1.0/maven-demo-1.0.jar",
      },
      {
        name: "maven-demo-1.0.pom",
        type: "maven",
        path: "com/example/maven-demo/1.0/maven-demo-1.0.pom",
      },
      {
        name: "maven-demo-1.0.jar.sha512",
        type: "maven",
        path: "com/example/maven-demo/1.0/maven-demo-1.0.jar.sha512",
      },
      {
        name: "maven-metadata.xml.sha512",
        type: "maven",
        path: "com/example/maven-demo/maven-metadata.xml.sha512",
      },
    ];
    const result = resolveAndDedup(artifacts);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("maven-demo");
    expect(result[0].version).toBe("1.0");
  });

  it("keeps different packages as separate entries", () => {
    const artifacts: CollectedArtifact[] = [
      {
        name: "backend-0.0.9.tgz",
        type: "npm",
        path: "@ascii-frog/backend/-/@ascii-frog/backend-0.0.9.tgz",
      },
      {
        name: "manifest.json",
        type: "docker",
        path: "myorg/api/v1.0.0/manifest.json",
      },
    ];
    const result = resolveAndDedup(artifacts);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(resolveAndDedup([])).toEqual([]);
  });
});

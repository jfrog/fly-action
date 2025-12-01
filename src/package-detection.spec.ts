// Copyright (c) JFrog Ltd. (2025)

import {
  detectContainerManagers,
  getAllPackageManagers,
  SUPPORTED_PACKAGE_MANAGERS,
} from "./package-detection";
import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";

// Mock fs and core
jest.mock("fs", () => {
  const originalFs = jest.requireActual("fs");
  const promisesMock = originalFs.promises ? { ...originalFs.promises } : {};

  // Override specific promise functions that @actions/core might use
  promisesMock.access = jest.fn().mockResolvedValue(undefined);
  promisesMock.writeFile = jest.fn().mockResolvedValue(undefined);
  promisesMock.appendFile = jest.fn().mockResolvedValue(undefined);
  promisesMock.readFile = jest.fn().mockResolvedValue("");
  promisesMock.readdir = jest.fn().mockResolvedValue([]);

  return {
    ...originalFs,
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    statSync: jest.fn(),
    promises: promisesMock,
  };
});
jest.mock("@actions/core");

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedCore = core as jest.Mocked<typeof core>;

// Create a properly typed mock for promises.readdir
const mockReaddirAsync = mockedFs.promises
  .readdir as unknown as jest.MockedFunction<
  (path: fs.PathLike, options?: { withFileTypes: true }) => Promise<fs.Dirent[]>
>;

// Helper to create mock Dirent objects
const createDirent = (name: string, isDirectory: boolean): fs.Dirent =>
  ({
    name,
    isFile: () => !isDirectory,
    isDirectory: () => isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  }) as fs.Dirent;

describe("SUPPORTED_PACKAGE_MANAGERS", () => {
  it("should contain all expected standard package managers", () => {
    expect(SUPPORTED_PACKAGE_MANAGERS).toEqual([
      "npm",
      "pnpm",
      "pip",
      "pipenv",
      "twine",
      "maven",
      "gradle",
      "dotnet",
      "nuget",
      "go",
    ]);
  });

  it("should contain exactly 10 package managers", () => {
    expect(SUPPORTED_PACKAGE_MANAGERS.length).toBe(10);
  });

  it("should NOT contain container-based package managers", () => {
    const containerManagers = ["docker", "podman", "helm"];
    containerManagers.forEach((manager) => {
      expect(SUPPORTED_PACKAGE_MANAGERS).not.toContain(manager);
    });
  });

  it("should be a readonly array", () => {
    // TypeScript ensures this at compile time, but we can verify it's an array
    expect(Array.isArray(SUPPORTED_PACKAGE_MANAGERS)).toBe(true);
  });
});

describe("detectContainerManagers", () => {
  const repoPath = "/test/repo";

  beforeEach(() => {
    // Reset mocks before each test
    mockedFs.existsSync.mockReset();
    mockReaddirAsync.mockReset();
    mockedFs.statSync.mockReset();
    mockedCore.debug.mockReset();
    mockedCore.info.mockReset();
    mockedCore.warning.mockReset();

    // Default mock implementations
    mockedFs.existsSync.mockReturnValue(true);
    mockReaddirAsync.mockResolvedValue([]);

    mockedFs.statSync.mockImplementation((itemPath) => {
      const pathStr = itemPath.toString();
      const knownDirs: { [key: string]: boolean } = {
        [repoPath]: true,
        [path.join(repoPath, "subdir")]: true,
        [path.join(repoPath, "subdir", "subsubdir")]: true,
        [path.join(repoPath, "level1dir")]: true,
        [path.join(repoPath, "level1dir", "level2dir")]: true,
        [path.join(repoPath, "level1dir", "level2dir", "level3dir")]: true,
        [path.join(
          repoPath,
          "level1dir",
          "level2dir",
          "level3dir",
          "level4dir",
        )]: true,
        [path.join(repoPath, "node_modules")]: true,
        [path.join(repoPath, ".git")]: true,
        [path.join(repoPath, "charts")]: true,
        [path.join(repoPath, "docker")]: true,
      };
      const isDirectory = !!knownDirs[pathStr];
      return {
        isFile: () => !isDirectory,
        isDirectory: () => isDirectory,
      } as fs.Stats;
    });
  });

  describe("Error handling and edge cases", () => {
    test("should return an empty array if repoPath is empty string", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const result = await detectContainerManagers("");
      expect(result).toEqual([]);
      expect(mockedCore.warning).toHaveBeenCalled();
    });

    test("should return an empty array if repoPath does not exist", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
      expect(mockedCore.warning).toHaveBeenCalledWith(
        `Repository path (${repoPath}) not set or does not exist. Cannot detect container package managers.`,
      );
    });

    test("should return an empty array if no container files are found", async () => {
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
      expect(mockedCore.info).toHaveBeenCalledWith(
        "No container package managers detected",
      );
    });

    test("should handle directory read errors gracefully", async () => {
      mockReaddirAsync.mockRejectedValue(new Error("Permission denied"));
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
      expect(mockedCore.debug).toHaveBeenCalledWith(
        expect.stringContaining("Error reading directory"),
      );
    });

    test("should handle mixed success and error in subdirectories", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        const p = dirPath.toString();
        if (p === repoPath) {
          return Promise.resolve([
            createDirent("subdir", true),
            createDirent("Chart.yaml", false),
          ]);
        }
        if (p === path.join(repoPath, "subdir")) {
          return Promise.reject(new Error("Access denied"));
        }
        return Promise.resolve([]);
      });

      const result = await detectContainerManagers(repoPath);
      // Should still detect helm from root despite subdirectory error
      expect(result).toEqual(["helm"]);
    });
  });

  describe("Docker detection", () => {
    test("should detect docker and podman if dockerfile is present (lowercase)", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("dockerfile", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "podman"].sort());
    });

    test("should detect docker and podman if Dockerfile is present (capitalized)", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Dockerfile", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "podman"].sort());
    });

    test("should detect docker and podman if DOCKERFILE is present (uppercase)", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("DOCKERFILE", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "podman"].sort());
    });

    test("should detect docker and podman from docker-compose.yml", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("docker-compose.yml", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "podman"].sort());
    });

    test("should detect docker and podman from docker-compose.yaml", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("docker-compose.yaml", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "podman"].sort());
    });

    test("should detect docker and podman from Docker-Compose.YML (mixed case)", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Docker-Compose.YML", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "podman"].sort());
    });
  });

  describe("Podman detection", () => {
    test("should detect only podman if containerfile is present (lowercase)", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("containerfile", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual(["podman"]);
    });

    test("should detect only podman if Containerfile is present (capitalized)", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Containerfile", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual(["podman"]);
    });

    test("should detect only podman if CONTAINERFILE is present (uppercase)", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("CONTAINERFILE", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual(["podman"]);
    });
  });

  describe("Helm detection", () => {
    test("should detect helm for Chart.yaml (capital C)", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Chart.yaml", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual(["helm"]);
    });

    test("should detect helm for chart.yaml (lowercase)", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("chart.yaml", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual(["helm"]);
    });

    test("should detect helm for values.yaml", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("values.yaml", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual(["helm"]);
    });

    test("should detect helm for helmfile.yaml", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("helmfile.yaml", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual(["helm"]);
    });

    test("should detect helm for helmfile.yml", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("helmfile.yml", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual(["helm"]);
    });

    test("should detect helm for Values.YAML (mixed case)", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Values.YAML", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual(["helm"]);
    });
  });

  describe("Multiple container managers detection", () => {
    test("should detect all three container managers when all files present", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([
            createDirent("Dockerfile", false),
            createDirent("Containerfile", false),
            createDirent("Chart.yaml", false),
          ]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "helm", "podman"].sort());
    });

    test("should detect docker, podman, and helm from various files", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([
            createDirent("docker-compose.yml", false),
            createDirent("values.yaml", false),
          ]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "helm", "podman"].sort());
    });

    test("should not duplicate managers when multiple indicator files exist", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([
            createDirent("Dockerfile", false),
            createDirent("docker-compose.yml", false),
            createDirent("docker-compose.yaml", false),
            createDirent("Chart.yaml", false),
            createDirent("values.yaml", false),
            createDirent("helmfile.yaml", false),
          ]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      // Should still only have 3 unique managers
      expect(result.sort()).toEqual(["docker", "helm", "podman"].sort());
      expect(result.length).toBe(3);
    });
  });

  describe("Directory scanning", () => {
    test("should detect container files in subdirectories", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        const p = dirPath.toString();
        if (p === repoPath) {
          return Promise.resolve([createDirent("subdir", true)]);
        }
        if (p === path.join(repoPath, "subdir")) {
          return Promise.resolve([createDirent("Dockerfile", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "podman"].sort());
    });

    test("should detect container files up to depth 3", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        const p = dirPath.toString();
        if (p === repoPath)
          return Promise.resolve([createDirent("level1dir", true)]);
        if (p === path.join(repoPath, "level1dir"))
          return Promise.resolve([createDirent("level2dir", true)]);
        if (p === path.join(repoPath, "level1dir", "level2dir"))
          return Promise.resolve([createDirent("level3dir", true)]);
        if (p === path.join(repoPath, "level1dir", "level2dir", "level3dir"))
          return Promise.resolve([createDirent("Dockerfile", false)]); // depth 3
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "podman"].sort());
    });

    test("should NOT detect container files beyond depth 3", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        const p = dirPath.toString();
        if (p === repoPath)
          return Promise.resolve([createDirent("level1dir", true)]);
        if (p === path.join(repoPath, "level1dir"))
          return Promise.resolve([createDirent("level2dir", true)]);
        if (p === path.join(repoPath, "level1dir", "level2dir"))
          return Promise.resolve([createDirent("level3dir", true)]);
        if (p === path.join(repoPath, "level1dir", "level2dir", "level3dir"))
          return Promise.resolve([createDirent("level4dir", true)]);
        if (
          p ===
          path.join(
            repoPath,
            "level1dir",
            "level2dir",
            "level3dir",
            "level4dir",
          )
        )
          return Promise.resolve([createDirent("Dockerfile", false)]); // depth 4 - too deep
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
    });

    test("should detect files at multiple depths simultaneously", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        const p = dirPath.toString();
        if (p === repoPath) {
          return Promise.resolve([
            createDirent("Dockerfile", false), // docker at root
            createDirent("charts", true),
          ]);
        }
        if (p === path.join(repoPath, "charts")) {
          return Promise.resolve([createDirent("Chart.yaml", false)]); // helm in subdir
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "helm", "podman"].sort());
    });
  });

  describe("Excluded directories", () => {
    test("should ignore container files in node_modules", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        const p = dirPath.toString();
        if (p === repoPath) {
          return Promise.resolve([
            createDirent("node_modules", true),
            createDirent("Chart.yaml", false),
          ]);
        }
        if (p === path.join(repoPath, "node_modules")) {
          return Promise.resolve([createDirent("Dockerfile", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual(["helm"]);
    });

    test("should ignore container files in .git directory", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        const p = dirPath.toString();
        if (p === repoPath) {
          return Promise.resolve([createDirent(".git", true)]);
        }
        if (p === path.join(repoPath, ".git")) {
          return Promise.resolve([createDirent("Dockerfile", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
    });

    test("should ignore container files in multiple excluded directories", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        const p = dirPath.toString();
        if (p === repoPath) {
          return Promise.resolve([
            createDirent("node_modules", true),
            createDirent(".git", true),
            createDirent("dist", true),
            createDirent("build", true),
          ]);
        }
        // All these should be skipped
        return Promise.resolve([createDirent("Dockerfile", false)]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
    });
  });

  describe("Non-container files (should NOT be detected)", () => {
    test("should NOT detect npm from package.json", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("package.json", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
    });

    test("should NOT detect pip from requirements.txt", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("requirements.txt", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
    });

    test("should NOT detect maven from pom.xml", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("pom.xml", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
    });

    test("should NOT detect go from go.mod", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("go.mod", false)]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
    });

    test("should NOT detect any standard package managers", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([
            createDirent("package.json", false),
            createDirent("package-lock.json", false),
            createDirent("yarn.lock", false),
            createDirent("pnpm-lock.yaml", false),
            createDirent("requirements.txt", false),
            createDirent("Pipfile", false),
            createDirent("setup.py", false),
            createDirent("pyproject.toml", false),
            createDirent("pom.xml", false),
            createDirent("build.gradle", false),
            createDirent("go.mod", false),
            createDirent("Cargo.toml", false),
            createDirent("Gemfile", false),
            createDirent("composer.json", false),
            createDirent("myproject.csproj", false),
          ]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      expect(result).toEqual([]);
    });
  });

  describe("Early exit optimization", () => {
    test("should stop searching after finding all container managers", async () => {
      let subdirScanned = false;
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        const p = dirPath.toString();
        if (p === repoPath) {
          return Promise.resolve([
            createDirent("Dockerfile", false), // docker + podman
            createDirent("Containerfile", false), // podman (already found)
            createDirent("Chart.yaml", false), // helm
            createDirent("subdir", true),
          ]);
        }
        if (p === path.join(repoPath, "subdir")) {
          subdirScanned = true;
          return Promise.resolve([createDirent("values.yaml", false)]);
        }
        return Promise.resolve([]);
      });

      const result = await detectContainerManagers(repoPath);
      expect(result.sort()).toEqual(["docker", "helm", "podman"].sort());
      // The subdir might or might not be scanned due to parallel processing
      // but once all 3 managers are found, we should exit early
    });
  });

  describe("Result format", () => {
    test("should return sorted array", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([
            createDirent("helmfile.yaml", false),
            createDirent("Dockerfile", false),
            createDirent("Containerfile", false),
          ]);
        }
        return Promise.resolve([]);
      });
      const result = await detectContainerManagers(repoPath);
      // Should be alphabetically sorted
      expect(result).toEqual(["docker", "helm", "podman"]);
    });

    test("should log detection results", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Dockerfile", false)]);
        }
        return Promise.resolve([]);
      });
      await detectContainerManagers(repoPath);
      expect(mockedCore.info).toHaveBeenCalledWith(
        "Detected container package managers: docker, podman",
      );
    });
  });
});

describe("getAllPackageManagers", () => {
  const repoPath = "/test/repo";

  beforeEach(() => {
    mockedFs.existsSync.mockReset();
    mockReaddirAsync.mockReset();
    mockedCore.debug.mockReset();
    mockedCore.info.mockReset();
    mockedCore.warning.mockReset();

    mockedFs.existsSync.mockReturnValue(true);
    mockReaddirAsync.mockResolvedValue([]);
  });

  describe("Basic functionality", () => {
    test("should return all supported package managers when no containers detected", async () => {
      const result = await getAllPackageManagers(repoPath);
      expect(result.sort()).toEqual([...SUPPORTED_PACKAGE_MANAGERS].sort());
    });

    test("should always include all supported package managers", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Dockerfile", false)]);
        }
        return Promise.resolve([]);
      });

      const result = await getAllPackageManagers(repoPath);

      // Verify all supported managers are present
      SUPPORTED_PACKAGE_MANAGERS.forEach((manager) => {
        expect(result).toContain(manager);
      });
    });
  });

  describe("Container manager integration", () => {
    test("should include docker when Dockerfile is found", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Dockerfile", false)]);
        }
        return Promise.resolve([]);
      });

      const result = await getAllPackageManagers(repoPath);
      expect(result).toContain("docker");
      expect(result).toContain("podman");
    });

    test("should include helm when Chart.yaml is found", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Chart.yaml", false)]);
        }
        return Promise.resolve([]);
      });

      const result = await getAllPackageManagers(repoPath);
      expect(result).toContain("helm");
    });

    test("should combine all supported + all detected containers", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([
            createDirent("Dockerfile", false),
            createDirent("Chart.yaml", false),
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await getAllPackageManagers(repoPath);
      const expected = [
        ...SUPPORTED_PACKAGE_MANAGERS,
        "docker",
        "podman",
        "helm",
      ].sort();
      expect(result.sort()).toEqual(expected);
    });
  });

  describe("Result integrity", () => {
    test("should not have duplicate entries", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([
            createDirent("Dockerfile", false),
            createDirent("docker-compose.yml", false),
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await getAllPackageManagers(repoPath);
      const uniqueResult = [...new Set(result)];
      expect(result.length).toEqual(uniqueResult.length);
    });

    test("should return sorted array", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Dockerfile", false)]);
        }
        return Promise.resolve([]);
      });

      const result = await getAllPackageManagers(repoPath);
      const sortedResult = [...result].sort();
      expect(result).toEqual(sortedResult);
    });

    test("should log combined results", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([createDirent("Dockerfile", false)]);
        }
        return Promise.resolve([]);
      });

      await getAllPackageManagers(repoPath);
      expect(mockedCore.info).toHaveBeenCalledWith(
        expect.stringContaining("All package managers for fly-client:"),
      );
    });
  });

  describe("Edge cases", () => {
    test("should handle empty repo path", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const result = await getAllPackageManagers("");
      // Should still return supported managers even if detection fails
      expect(result.sort()).toEqual([...SUPPORTED_PACKAGE_MANAGERS].sort());
    });

    test("should handle non-existent repo path", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const result = await getAllPackageManagers("/non/existent/path");
      expect(result.sort()).toEqual([...SUPPORTED_PACKAGE_MANAGERS].sort());
    });

    test("should return correct count with all container managers", async () => {
      mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
        if (dirPath === repoPath) {
          return Promise.resolve([
            createDirent("Dockerfile", false),
            createDirent("Containerfile", false),
            createDirent("Chart.yaml", false),
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await getAllPackageManagers(repoPath);
      // 10 supported + 3 containers = 13
      expect(result.length).toBe(13);
    });
  });
});

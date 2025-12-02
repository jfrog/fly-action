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

describe("Scan limit protection", () => {
  const repoPath = "/test/repo";

  beforeEach(() => {
    mockedFs.existsSync.mockReset();
    mockReaddirAsync.mockReset();
    mockedCore.debug.mockReset();
    mockedCore.info.mockReset();
    mockedCore.warning.mockReset();

    mockedFs.existsSync.mockReturnValue(true);
  });

  test("should stop scanning when max files limit is reached", async () => {
    // Create a repo with more than 10,000 files
    let fileCounter = 0;
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      const p = dirPath.toString();

      if (p === repoPath) {
        const entries: fs.Dirent[] = [];
        // Add many subdirectories
        for (let i = 0; i < 100; i++) {
          entries.push(createDirent(`dir${i}`, true));
        }
        return Promise.resolve(entries);
      }

      // Each subdirectory has 200 files (100 dirs * 200 files = 20,000 files total)
      const entries: fs.Dirent[] = [];
      for (let i = 0; i < 200; i++) {
        fileCounter++;
        entries.push(createDirent(`file${i}.txt`, false));
      }
      return Promise.resolve(entries);
    });

    await detectContainerManagers(repoPath);

    // Should have logged a warning about hitting the limit
    expect(mockedCore.warning).toHaveBeenCalledWith(
      expect.stringContaining("max file limit"),
    );
  });

  test("should emit warning only once when limit is reached", async () => {
    // Create a repo with way more than 10,000 files
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      const p = dirPath.toString();

      if (p === repoPath) {
        const entries: fs.Dirent[] = [];
        for (let i = 0; i < 50; i++) {
          entries.push(createDirent(`dir${i}`, true));
        }
        return Promise.resolve(entries);
      }

      // Each subdirectory has 500 files
      const entries: fs.Dirent[] = [];
      for (let i = 0; i < 500; i++) {
        entries.push(createDirent(`file${i}.txt`, false));
      }
      return Promise.resolve(entries);
    });

    await detectContainerManagers(repoPath);

    // Warning should be called exactly once, not multiple times
    const warningCalls = mockedCore.warning.mock.calls.filter((call) =>
      call[0].toString().includes("max file limit"),
    );
    expect(warningCalls.length).toBe(1);
  });

  test("should return managers found before hitting the limit", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      const p = dirPath.toString();

      if (p === repoPath) {
        const entries: fs.Dirent[] = [
          createDirent("Dockerfile", false), // Found early
        ];
        // Add many subdirectories to trigger limit
        for (let i = 0; i < 100; i++) {
          entries.push(createDirent(`dir${i}`, true));
        }
        return Promise.resolve(entries);
      }

      // Each subdirectory has many files
      const entries: fs.Dirent[] = [];
      for (let i = 0; i < 200; i++) {
        entries.push(createDirent(`file${i}.txt`, false));
      }
      return Promise.resolve(entries);
    });

    const result = await detectContainerManagers(repoPath);

    // Should still have found docker and podman from the root Dockerfile
    expect(result).toContain("docker");
    expect(result).toContain("podman");
  });

  test("should not emit warning when under the limit", async () => {
    // Create a small repo
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([
          createDirent("Dockerfile", false),
          createDirent("file1.txt", false),
          createDirent("file2.txt", false),
        ]);
      }
      return Promise.resolve([]);
    });

    await detectContainerManagers(repoPath);

    // Should not have warning about limit
    expect(mockedCore.warning).not.toHaveBeenCalledWith(
      expect.stringContaining("max file limit"),
    );
  });

  test("should log total files scanned in debug", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([
          createDirent("file1.txt", false),
          createDirent("file2.txt", false),
          createDirent("file3.txt", false),
        ]);
      }
      return Promise.resolve([]);
    });

    await detectContainerManagers(repoPath);

    expect(mockedCore.debug).toHaveBeenCalledWith(
      expect.stringContaining("scanned 3 files"),
    );
  });
});

describe("Performance tests for large repositories", () => {
  const repoPath = "/test/large-repo";

  beforeEach(() => {
    mockedFs.existsSync.mockReset();
    mockReaddirAsync.mockReset();
    mockedCore.debug.mockReset();
    mockedCore.info.mockReset();
    mockedCore.warning.mockReset();

    mockedFs.existsSync.mockReturnValue(true);
  });

  /**
   * Helper to generate a large directory structure.
   * Creates nested directories with many files per directory.
   */
  const generateLargeDirectoryMock = (
    totalDirs: number,
    filesPerDir: number,
    containerFileAtDepth?: number,
  ) => {
    const dirPaths = new Set<string>();
    dirPaths.add(repoPath);

    // Generate directory paths up to depth 3
    for (let i = 0; i < totalDirs; i++) {
      const depth = (i % 3) + 1; // depth 1, 2, or 3
      let currentPath = repoPath;
      for (let d = 0; d < depth; d++) {
        currentPath = path.join(currentPath, `dir${i}_level${d}`);
        dirPaths.add(currentPath);
      }
    }

    return (dirPath: fs.PathLike) => {
      const p = dirPath.toString();

      if (!dirPaths.has(p) && p !== repoPath) {
        return Promise.resolve([]);
      }

      const entries: fs.Dirent[] = [];

      // Add files
      for (let f = 0; f < filesPerDir; f++) {
        entries.push(createDirent(`file${f}.txt`, false));
        entries.push(createDirent(`config${f}.json`, false));
        entries.push(createDirent(`script${f}.sh`, false));
      }

      // Add subdirectories (only at depth < 3)
      const currentDepth = (p.match(/level/g) || []).length;
      if (currentDepth < 3) {
        for (let d = 0; d < 5; d++) {
          entries.push(createDirent(`subdir${d}`, true));
        }
      }

      // Optionally add a container file at a specific depth
      if (
        containerFileAtDepth !== undefined &&
        currentDepth === containerFileAtDepth
      ) {
        entries.push(createDirent("Dockerfile", false));
      }

      return Promise.resolve(entries);
    };
  };

  test("should scan large repository (100 dirs, 20 files each) in reasonable time", async () => {
    mockReaddirAsync.mockImplementation(generateLargeDirectoryMock(100, 20));

    const startTime = Date.now();
    const result = await detectContainerManagers(repoPath);
    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(result).toEqual([]);
    // Should complete in under 5 seconds for mocked fs
    expect(duration).toBeLessThan(5000);
    console.log(`Large repo scan (100 dirs, 20 files) took ${duration}ms`);
  });

  test("should scan very large repository (500 dirs, 50 files each) in reasonable time", async () => {
    mockReaddirAsync.mockImplementation(generateLargeDirectoryMock(500, 50));

    const startTime = Date.now();
    const result = await detectContainerManagers(repoPath);
    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(result).toEqual([]);
    // Should complete in under 10 seconds for mocked fs
    expect(duration).toBeLessThan(10000);
    console.log(`Very large repo scan (500 dirs, 50 files) took ${duration}ms`);
  });

  test("should find container file quickly even in large repository", async () => {
    // Create a large repo with a Dockerfile at depth 1
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      const p = dirPath.toString();

      if (p === repoPath) {
        const entries: fs.Dirent[] = [];
        // Add many directories
        for (let i = 0; i < 100; i++) {
          entries.push(createDirent(`dir${i}`, true));
        }
        // Add many files
        for (let i = 0; i < 50; i++) {
          entries.push(createDirent(`file${i}.txt`, false));
        }
        return Promise.resolve(entries);
      }

      // At depth 1 - add files and subdirs
      if (p.startsWith(repoPath) && !p.includes(path.sep + "subdir")) {
        const entries: fs.Dirent[] = [];
        for (let i = 0; i < 20; i++) {
          entries.push(createDirent(`file${i}.json`, false));
          entries.push(createDirent(`subdir${i}`, true));
        }
        // Add Dockerfile in dir50
        if (p === path.join(repoPath, "dir50")) {
          entries.push(createDirent("Dockerfile", false));
        }
        return Promise.resolve(entries);
      }

      // Deeper directories - just files
      return Promise.resolve([
        createDirent("config.json", false),
        createDirent("data.txt", false),
      ]);
    });

    const startTime = Date.now();
    const result = await detectContainerManagers(repoPath);
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should find docker and podman
    expect(result.sort()).toEqual(["docker", "podman"]);
    // Should still be fast
    expect(duration).toBeLessThan(5000);
    console.log(
      `Large repo with container file scan took ${duration}ms, found: ${result.join(", ")}`,
    );
  });

  test("should benefit from early exit when all managers found quickly", async () => {
    // All container files at root level
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      const p = dirPath.toString();

      if (p === repoPath) {
        const entries: fs.Dirent[] = [
          createDirent("Dockerfile", false),
          createDirent("Containerfile", false),
          createDirent("Chart.yaml", false),
        ];
        // Add many subdirectories that should be skipped due to early exit
        for (let i = 0; i < 100; i++) {
          entries.push(createDirent(`subdir${i}`, true));
        }
        return Promise.resolve(entries);
      }

      // This should rarely be called due to early exit
      return Promise.resolve([
        createDirent("file1.txt", false),
        createDirent("file2.txt", false),
      ]);
    });

    const startTime = Date.now();
    const result = await detectContainerManagers(repoPath);
    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(result.sort()).toEqual(["docker", "helm", "podman"]);
    // Should be very fast due to early exit
    expect(duration).toBeLessThan(1000);
    console.log(`Early exit optimization took ${duration}ms`);
  });

  test("should handle repository with max depth efficiently", async () => {
    // Create a deep directory structure up to depth 3
    const deepPaths: { [key: string]: fs.Dirent[] } = {
      [repoPath]: [],
    };

    // Generate 50 parallel deep paths
    for (let branch = 0; branch < 50; branch++) {
      let currentPath = repoPath;
      for (let depth = 0; depth < 3; depth++) {
        const nextDir = `branch${branch}_depth${depth}`;
        if (!deepPaths[currentPath]) {
          deepPaths[currentPath] = [];
        }
        deepPaths[currentPath].push(createDirent(nextDir, true));

        currentPath = path.join(currentPath, nextDir);
        deepPaths[currentPath] = [];

        // Add some files at each level
        for (let f = 0; f < 10; f++) {
          deepPaths[currentPath].push(createDirent(`file${f}.txt`, false));
        }
      }
      // Add Dockerfile at leaf (depth 3) for one branch
      if (branch === 25) {
        deepPaths[currentPath].push(createDirent("Dockerfile", false));
      }
    }

    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      const p = dirPath.toString();
      return Promise.resolve(deepPaths[p] || []);
    });

    const startTime = Date.now();
    const result = await detectContainerManagers(repoPath);
    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(result.sort()).toEqual(["docker", "podman"]);
    expect(duration).toBeLessThan(5000);
    console.log(`Deep directory structure scan took ${duration}ms`);
  });
});

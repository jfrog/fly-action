// Copyright (c) JFrog Ltd. (2025)

import {
  detectPackageManagers,
  getAllPackageManagers,
  SUPPORTED_PACKAGE_MANAGERS,
} from "./package-detection";
import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";

// Mock fs and core
jest.mock("fs", () => {
  const originalFs = jest.requireActual("fs");

  return {
    ...originalFs,
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    statSync: jest.fn(),
    promises: {
      access: jest.fn(),
      writeFile: jest.fn(),
      appendFile: jest.fn(),
      readFile: jest.fn(),
    },
  };
});
jest.mock("@actions/core");

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedCore = core as jest.Mocked<typeof core>;

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
});

describe("detectPackageManagers", () => {
  const repoPath = "/test/repo";

  beforeEach(() => {
    // Reset mocks before each test
    mockedFs.existsSync.mockReset();
    mockedFs.readdirSync.mockReset();
    mockedFs.statSync.mockReset();
    mockedCore.debug.mockReset();
    mockedCore.info.mockReset();
    mockedCore.warning.mockReset();

    // Default mock implementations
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readdirSync.mockReturnValue([]);

    mockedFs.statSync.mockImplementation((itemPath) => {
      const pathStr = itemPath.toString();
      const knownDirs: { [key: string]: boolean } = {
        [repoPath]: true,
        [path.join(repoPath, "subdir")]: true,
      };
      const isDirectory = !!knownDirs[pathStr];
      return {
        isFile: () => !isDirectory,
        isDirectory: () => isDirectory,
      } as fs.Stats;
    });
  });

  describe("Error handling and edge cases", () => {
    test("should return an empty array if repoPath is empty string", () => {
      mockedFs.existsSync.mockReturnValue(false);
      const result = detectPackageManagers("");
      expect(result).toEqual([]);
      expect(mockedCore.warning).toHaveBeenCalled();
    });

    test("should return an empty array if repoPath does not exist", () => {
      mockedFs.existsSync.mockReturnValue(false);
      const result = detectPackageManagers(repoPath);
      expect(result).toEqual([]);
      expect(mockedCore.warning).toHaveBeenCalled();
    });

    test("should return an empty array if no package manager files are found", () => {
      const result = detectPackageManagers(repoPath);
      expect(result).toEqual([]);
      expect(mockedCore.info).toHaveBeenCalledWith(
        "Detected package managers: none",
      );
    });
  });

  describe("Package manager detection", () => {
    test("should detect npm from package.json", () => {
      mockedFs.readdirSync.mockReturnValue([createDirent("package.json", false)] as any);
      const result = detectPackageManagers(repoPath);
      expect(result).toContain("npm");
    });

    test("should detect docker from Dockerfile", () => {
      mockedFs.readdirSync.mockReturnValue([createDirent("Dockerfile", false)] as any);
      const result = detectPackageManagers(repoPath);
      expect(result).toContain("docker");
    });

    test("should detect helm from Chart.yaml", () => {
      mockedFs.readdirSync.mockReturnValue([createDirent("Chart.yaml", false)] as any);
      const result = detectPackageManagers(repoPath);
      expect(result).toContain("helm");
    });

    test("should detect pip from requirements.txt", () => {
      mockedFs.readdirSync.mockReturnValue([createDirent("requirements.txt", false)] as any);
      const result = detectPackageManagers(repoPath);
      expect(result).toContain("pip");
    });

    test("should detect maven from pom.xml", () => {
      mockedFs.readdirSync.mockReturnValue([createDirent("pom.xml", false)] as any);
      const result = detectPackageManagers(repoPath);
      expect(result).toContain("maven");
    });

    test("should detect go from go.mod", () => {
      mockedFs.readdirSync.mockReturnValue([createDirent("go.mod", false)] as any);
      const result = detectPackageManagers(repoPath);
      expect(result).toContain("go");
    });

    test("should detect multiple package managers", () => {
      mockedFs.readdirSync.mockReturnValue([
        createDirent("package.json", false),
        createDirent("Dockerfile", false),
        createDirent("go.mod", false),
      ] as any);
      const result = detectPackageManagers(repoPath);
      expect(result).toContain("npm");
      expect(result).toContain("docker");
      expect(result).toContain("go");
    });
  });

  describe("Directory scanning", () => {
    test("should detect package managers in subdirectories", () => {
      mockedFs.readdirSync.mockImplementation((dirPath: any) => {
        const p = dirPath.toString();
        if (p === repoPath) {
          return [createDirent("subdir", true)] as any;
        }
        if (p === path.join(repoPath, "subdir")) {
          return [createDirent("package.json", false)] as any;
        }
        return [] as any;
      });
      const result = detectPackageManagers(repoPath);
      expect(result).toContain("npm");
    });

    test("should skip excluded directories", () => {
      mockedFs.readdirSync.mockImplementation((dirPath: any) => {
        const p = dirPath.toString();
        if (p === repoPath) {
          return [
            createDirent("node_modules", true),
            createDirent("package.json", false),
          ] as any;
        }
        if (p === path.join(repoPath, "node_modules")) {
          // This shouldn't be called because node_modules should be skipped
          return [createDirent("other-package.json", false)] as any;
        }
        return [] as any;
      });
      
      mockedFs.statSync.mockImplementation((itemPath) => {
        const pathStr = itemPath.toString();
        const isDirectory = pathStr === repoPath || pathStr === path.join(repoPath, "node_modules");
        return {
          isFile: () => !isDirectory,
          isDirectory: () => isDirectory,
        } as fs.Stats;
      });
      
      const result = detectPackageManagers(repoPath);
      expect(result).toContain("npm");
      // Should skip node_modules
      expect(mockedCore.debug).toHaveBeenCalledWith(
        expect.stringContaining("Skipping excluded directory"),
      );
    });
  });
});

describe("getAllPackageManagers", () => {
  const repoPath = "/test/repo";

  beforeEach(() => {
    mockedFs.existsSync.mockReset();
    mockedFs.readdirSync.mockReset();
    mockedFs.statSync.mockReset();
    mockedCore.debug.mockReset();
    mockedCore.info.mockReset();
    mockedCore.warning.mockReset();

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockImplementation((itemPath) => {
      const pathStr = itemPath.toString();
      const isDirectory = pathStr === repoPath;
      return {
        isFile: () => !isDirectory,
        isDirectory: () => isDirectory,
      } as fs.Stats;
    });
  });

  test("should return all supported package managers when no containers detected", () => {
    mockedFs.readdirSync.mockReturnValue([createDirent("package.json", false)] as any);
    
    const result = getAllPackageManagers(repoPath);
    expect(result).toEqual(expect.arrayContaining([...SUPPORTED_PACKAGE_MANAGERS]));
    expect(result).not.toContain("docker");
    expect(result).not.toContain("helm");
    expect(result).not.toContain("podman");
  });

  test("should include docker when Dockerfile is detected", () => {
    mockedFs.readdirSync.mockReturnValue([createDirent("Dockerfile", false)] as any);

    const result = getAllPackageManagers(repoPath);
    expect(result).toContain("docker");
    expect(result).toEqual(expect.arrayContaining([...SUPPORTED_PACKAGE_MANAGERS]));
  });

  test("should include helm when Chart.yaml is detected", () => {
    mockedFs.readdirSync.mockReturnValue([createDirent("Chart.yaml", false)] as any);

    const result = getAllPackageManagers(repoPath);
    expect(result).toContain("helm");
    expect(result).toEqual(expect.arrayContaining([...SUPPORTED_PACKAGE_MANAGERS]));
  });

  test("should include all containers when detected", () => {
    mockedFs.readdirSync.mockReturnValue([
      createDirent("Dockerfile", false),
      createDirent("Chart.yaml", false),
    ] as any);

    const result = getAllPackageManagers(repoPath);
    expect(result).toContain("docker");
    expect(result).toContain("helm");
    expect(result).toEqual(expect.arrayContaining([...SUPPORTED_PACKAGE_MANAGERS]));
  });
});

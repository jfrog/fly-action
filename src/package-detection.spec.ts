// @ts-nocheck
import { detectPackageManagers } from "./package-detection";
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
  // Add other fs.promises functions here if needed, or ensure they are covered by the spread

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
    mockedFs.existsSync.mockReturnValue(true); // Assume repoPath exists by default
    mockedFs.readdirSync.mockReturnValue([]); // Default to empty Dirent array

    mockedFs.statSync.mockImplementation((itemPath) => {
      const pathStr = itemPath.toString();
      // This lookup helps fs.statSync(currentDir).isDirectory() in findFilesRecursive
      const knownDirs: { [key: string]: boolean } = {
        [repoPath]: true,
        [path.join(repoPath, "subdir")]: true,
        [path.join(repoPath, "subdir", "subsubdir")]: true,
        [path.join(repoPath, "level1dir")]: true,
        [path.join(repoPath, "level1dir", "level2dir")]: true,
        [path.join(repoPath, "level1dir", "level2dir", "level3dir")]: true, // For depth check, this dir itself is valid
        [path.join(repoPath, "node_modules")]: true,
        [path.join(repoPath, ".git")]: true,
        [path.join(repoPath, "srcdir")]: true,
        [path.join(repoPath, "clientdir")]: true,
        [path.join(repoPath, "clientdir", "level2dir")]: true,
        [path.join(repoPath, "clientdir", "level2dir", "deepdir")]: true, // For depth check
      };
      const isDirectory = !!knownDirs[pathStr];
      return {
        isFile: () => !isDirectory,
        isDirectory: () => isDirectory,
      } as fs.Stats;
    });
  });

  test("should return an empty array if repoPath does not exist", () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual([]);
    expect(mockedCore.warning).toHaveBeenCalledWith(
      `GITHUB_WORKSPACE (${repoPath}) not set or does not exist. Cannot detect package managers.`,
    );
  });

  test("should return an empty array if no package manager files are found", () => {
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual([]);
    expect(mockedCore.info).toHaveBeenCalledWith(
      "Detected package managers: none",
    );
  });

  test("should detect npm if package.json is present at root", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [createDirent("package.json", false)];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["npm"]);
  });

  test("should detect yarn if yarn.lock is present at root", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [
          createDirent("yarn.lock", false),
          createDirent("package.json", false),
        ];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    // Based on current logic (no post-processing), both might be detected if both files are checked.
    // The order in PACKAGE_MANAGER_FILE_IDENTIFIERS is: pnpm, yarn, npm.
    // So yarn.lock will add 'yarn', then package.json will add 'npm'.
    expect(result.sort()).toEqual(["npm", "yarn"].sort());
  });

  test("should detect pnpm if pnpm-lock.yaml is present at root", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [
          createDirent("pnpm-lock.yaml", false),
          createDirent("package.json", false),
        ];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    // pnpm-lock.yaml is first, then package.json for npm.
    expect(result.sort()).toEqual(["npm", "pnpm"].sort());
  });

  test("should detect poetry if poetry.lock is present", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [
          createDirent("poetry.lock", false),
          createDirent("pyproject.toml", false),
        ];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    // poetry.lock adds 'poetry', pyproject.toml adds 'pip'.
    expect(result.sort()).toEqual(["pip", "poetry"].sort());
  });

  test("should detect pipenv if Pipfile is present", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [
          createDirent("pipfile", false), // Assuming 'pipfile' is the exact name checked (case-sensitively for mock)
          createDirent("pyproject.toml", false),
        ];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    // pipfile adds 'pipenv', pyproject.toml adds 'pip'.
    expect(result.sort()).toEqual(["pip", "pipenv"].sort());
  });

  test("should detect pip for requirements.txt", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [createDirent("requirements.txt", false)];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["pip"]);
  });

  test("should detect maven for pom.xml", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [createDirent("pom.xml", false)];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["maven"]);
  });

  test("should detect gradle for build.gradle", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [createDirent("build.gradle", false)];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["gradle"]);
  });

  test("should detect dotnet for .csproj file", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [createDirent("myproject.csproj", false)];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["dotnet"]);
  });

  test("should detect nuget for .nuspec file", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [createDirent("mypackage.nuspec", false)];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["nuget"]);
  });

  test("should detect docker for Dockerfile (case-insensitive)", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [createDirent("Dockerfile", false)];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["docker"]);
  });

  test("should detect helm for Chart.yaml (case-insensitive)", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [createDirent("Chart.yaml", false)];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["helm"]);
  });

  test("should detect multiple package managers at root", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [
          createDirent("package.json", false),
          createDirent("pom.xml", false),
          createDirent("requirements.txt", false),
        ];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result.sort()).toEqual(["maven", "npm", "pip"].sort());
  });

  test("should detect files in subdirectories up to MAX_DEPTH", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      const p = dirPath.toString();
      if (p === repoPath) {
        return [createDirent("subdir", true)];
      }
      if (p === path.join(repoPath, "subdir")) {
        return [
          createDirent("package.json", false),
          createDirent("subsubdir", true),
        ];
      }
      if (p === path.join(repoPath, "subdir", "subsubdir")) {
        return [createDirent("pom.xml", false)];
      }
      return [];
    });
    // The statSync mock in beforeEach should handle isDirectory for "subdir" and "subsubdir"
    const result = detectPackageManagers(repoPath);
    expect(result.sort()).toEqual(["maven", "npm"].sort());
  });

  test("should ignore files beyond MAX_DEPTH", () => {
    // MAX_DEPTH is 2 (0, 1, 2). So level3dir (depth 3) should be ignored.
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      const p = dirPath.toString();
      if (p === repoPath) return [createDirent("level1dir", true)];
      if (p === path.join(repoPath, "level1dir"))
        return [createDirent("level2dir", true)];
      // Files in level2dir are at depth 2
      if (p === path.join(repoPath, "level1dir", "level2dir")) {
        return [
          createDirent("package.json", false), // npm at depth 2
          createDirent("level3dir", true),
        ];
      }
      // Files in level3dir are at depth 3
      if (p === path.join(repoPath, "level1dir", "level2dir", "level3dir")) {
        return [createDirent("pom.xml", false)]; // maven at depth 3 (ignored)
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["npm"]); // Only npm from depth 2
  });

  test("should ignore files in excluded directories", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      const p = dirPath.toString();
      if (p === repoPath) {
        // node_modules is a directory
        return [
          createDirent("node_modules", true),
          createDirent("package.json", false),
        ];
      }
      if (p === path.join(repoPath, "node_modules")) {
        return [createDirent("pom.xml", false)]; // This should be ignored
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["npm"]); // Only npm from repo root
  });

  test("should handle case insensitivity for found filenames", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [
          createDirent("PACKAGE.JSON", false),
          createDirent("POM.XML", false),
        ];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result.sort()).toEqual(["maven", "npm"].sort());
  });

  test("should correctly identify unique managers if multiple indicator files for the same manager are found", () => {
    mockedFs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath === repoPath) {
        return [
          createDirent("requirements.txt", false),
          createDirent("setup.py", false),
          createDirent("pyproject.toml", false),
        ];
      }
      return [];
    });
    const result = detectPackageManagers(repoPath);
    expect(result).toEqual(["pip"]);
  });

  test("complex scenario with mixed files, depths, and excluded dirs", () => {
    mockedFs.readdirSync.mockImplementation((p) => {
      const dirPathStr = p.toString();
      if (dirPathStr === repoPath) {
        return [
          createDirent("package.json", false), // npm (depth 0)
          createDirent("srcdir", true),
          createDirent(".git", true), // excluded
          createDirent("clientdir", true),
        ];
      }
      if (dirPathStr === path.join(repoPath, "srcdir")) {
        // depth 1
        return [
          createDirent("pom.xml", false), // maven (depth 1)
          createDirent("node_modules", true), // excluded
        ];
      }
      if (dirPathStr === path.join(repoPath, "srcdir", "node_modules")) {
        // depth 2, but excluded path
        return [createDirent("yarn.lock", false)];
      }
      if (dirPathStr === path.join(repoPath, "clientdir")) {
        // depth 1
        return [createDirent("level2dir", true)];
      }
      if (dirPathStr === path.join(repoPath, "clientdir", "level2dir")) {
        // depth 2
        return [
          createDirent("requirements.txt", false), // pip (depth 2)
          createDirent("deepdir", true),
        ];
      }
      if (
        dirPathStr === path.join(repoPath, "clientdir", "level2dir", "deepdir")
      ) {
        // depth 3 (too deep if MAX_DEPTH = 2)
        return [createDirent("go.mod", false)];
      }
      return [];
    });

    const result = detectPackageManagers(repoPath);
    // Expected: npm (root), maven (srcdir), pip (clientdir/level2dir)
    // MAX_DEPTH is 2, meaning depths 0, 1, 2 are scanned.
    // - package.json at depth 0 -> npm
    // - pom.xml at depth 1 (in srcdir) -> maven
    // - .git at depth 0 is excluded.
    // - node_modules in srcdir is excluded.
    // - requirements.txt at depth 2 (in clientdir/level2dir) -> pip
    // - go.mod at depth 3 (in clientdir/level2dir/deepdir) is too deep.
    expect(result.sort()).toEqual(["maven", "npm", "pip"].sort());
  });
});

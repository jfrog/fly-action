// Copyright (c) JFrog Ltd. (2025)

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
  promisesMock.readdir = jest.fn().mockResolvedValue([]);
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

// Create a properly typed mock for readdirSync (kept for backwards compat if needed)
const mockReaddirSync = mockedFs.readdirSync as unknown as jest.MockedFunction<
  (path: fs.PathLike) => fs.Dirent[]
>;

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

describe("detectPackageManagers", () => {
  const repoPath = "/test/repo";

  beforeEach(() => {
    // Reset mocks before each test
    mockedFs.existsSync.mockReset();
    mockReaddirSync.mockReset();
    mockReaddirAsync.mockReset();
    mockedFs.statSync.mockReset();
    mockedCore.debug.mockReset();
    mockedCore.info.mockReset();
    mockedCore.warning.mockReset();

    // Default mock implementations
    mockedFs.existsSync.mockReturnValue(true); // Assume repoPath exists by default
    mockReaddirSync.mockReturnValue([]); // Default to empty Dirent array (legacy)
    mockReaddirAsync.mockResolvedValue([]); // Default to empty Dirent array (async)

    mockedFs.statSync.mockImplementation((itemPath) => {
      const pathStr = itemPath.toString();
      // This lookup helps fs.statSync(currentDir).isDirectory() in findFilesRecursive
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
        [path.join(repoPath, "srcdir")]: true,
        [path.join(repoPath, "clientdir")]: true,
        [path.join(repoPath, "clientdir", "level2dir")]: true,
        [path.join(repoPath, "clientdir", "level2dir", "deepdir")]: true,
        [path.join(repoPath, "clientdir", "level2dir", "deepdir", "level4dir")]:
          true,
      };
      const isDirectory = !!knownDirs[pathStr];
      return {
        isFile: () => !isDirectory,
        isDirectory: () => isDirectory,
      } as fs.Stats;
    });
  });

  test("should return an empty array if repoPath does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual([]);
    expect(mockedCore.warning).toHaveBeenCalledWith(
      `GITHUB_WORKSPACE (${repoPath}) not set or does not exist. Cannot detect package managers.`,
    );
  });

  test("should return an empty array if no package manager files are found", async () => {
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual([]);
    expect(mockedCore.info).toHaveBeenCalledWith(
      "Detected package managers: none",
    );
  });

  test("should detect npm if package.json is present at root", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([createDirent("package.json", false)]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual(["npm"]);
  });

  test("should detect yarn if yarn.lock is present at root", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([
          createDirent("yarn.lock", false),
          createDirent("package.json", false),
        ]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    // Based on current logic (no post-processing), both might be detected if both files are checked.
    // The order in PACKAGE_MANAGER_FILE_IDENTIFIERS is: pnpm, yarn, npm.
    // So yarn.lock will add 'yarn', then package.json will add 'npm'.
    expect(result.sort()).toEqual(["npm", "yarn"].sort());
  });

  test("should detect pnpm if pnpm-lock.yaml is present at root", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([
          createDirent("pnpm-lock.yaml", false),
          createDirent("package.json", false),
        ]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    // pnpm-lock.yaml is first, then package.json for npm.
    expect(result.sort()).toEqual(["npm", "pnpm"].sort());
  });

  test("should detect poetry if poetry.lock is present", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([
          createDirent("poetry.lock", false),
          createDirent("pyproject.toml", false),
        ]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    // poetry.lock adds 'poetry', pyproject.toml adds 'pip'.
    expect(result.sort()).toEqual(["pip", "poetry"].sort());
  });

  test("should detect pipenv if Pipfile is present", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([
          createDirent("pipfile", false), // Assuming 'pipfile' is the exact name checked (case-sensitively for mock)
          createDirent("pyproject.toml", false),
        ]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    // pipfile adds 'pipenv', pyproject.toml adds 'pip'.
    expect(result.sort()).toEqual(["pip", "pipenv"].sort());
  });

  test("should detect pip for requirements.txt", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([createDirent("requirements.txt", false)]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual(["pip"]);
  });

  test("should detect maven for pom.xml", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([createDirent("pom.xml", false)]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual(["maven"]);
  });

  test("should detect gradle for build.gradle", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([createDirent("build.gradle", false)]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual(["gradle"]);
  });

  test("should detect dotnet for .csproj file", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([createDirent("myproject.csproj", false)]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual(["dotnet"]);
  });

  test("should detect nuget for .nuspec file", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([createDirent("mypackage.nuspec", false)]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual(["nuget"]);
  });

  test("should detect docker for Dockerfile (case-insensitive)", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([createDirent("Dockerfile", false)]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual(["docker"]);
  });

  test("should detect helm for Chart.yaml (case-insensitive)", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([createDirent("Chart.yaml", false)]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual(["helm"]);
  });

  test("should detect multiple package managers at root", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([
          createDirent("package.json", false),
          createDirent("pom.xml", false),
          createDirent("requirements.txt", false),
        ]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result.sort()).toEqual(["maven", "npm", "pip"].sort());
  });

  test("should detect files in subdirectories up to MAX_DEPTH", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      const p = dirPath.toString();
      if (p === repoPath) {
        return Promise.resolve([createDirent("subdir", true)]);
      }
      if (p === path.join(repoPath, "subdir")) {
        return Promise.resolve([
          createDirent("package.json", false),
          createDirent("subsubdir", true),
        ]);
      }
      if (p === path.join(repoPath, "subdir", "subsubdir")) {
        return Promise.resolve([createDirent("pom.xml", false)]);
      }
      return Promise.resolve([]);
    });
    // The statSync mock in beforeEach should handle isDirectory for "subdir" and "subsubdir"
    const result = await detectPackageManagers(repoPath);
    expect(result.sort()).toEqual(["maven", "npm"].sort());
  });

  test("should ignore files beyond MAX_DEPTH", async () => {
    // MAX_DEPTH is 3 (0, 1, 2, 3). So level4dir (depth 4) should be ignored.
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      const p = dirPath.toString();
      if (p === repoPath)
        return Promise.resolve([createDirent("level1dir", true)]);
      if (p === path.join(repoPath, "level1dir"))
        return Promise.resolve([createDirent("level2dir", true)]);
      if (p === path.join(repoPath, "level1dir", "level2dir")) {
        return Promise.resolve([
          createDirent("package.json", false), // npm at depth 2
          createDirent("level3dir", true),
        ]);
      }
      // Files in level3dir are at depth 3 (should be included)
      if (p === path.join(repoPath, "level1dir", "level2dir", "level3dir")) {
        return Promise.resolve([
          createDirent("pom.xml", false), // maven at depth 3 (included)
          createDirent("level4dir", true),
        ]);
      }
      // Files in level4dir are at depth 4 (should be ignored)
      if (
        p ===
        path.join(repoPath, "level1dir", "level2dir", "level3dir", "level4dir")
      ) {
        return Promise.resolve([createDirent("build.gradle", false)]); // gradle at depth 4 (ignored)
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result.sort()).toEqual(["maven", "npm"].sort()); // npm at depth 2, maven at depth 3
  });

  test("should ignore files in excluded directories", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      const p = dirPath.toString();
      if (p === repoPath) {
        // node_modules is a directory
        return Promise.resolve([
          createDirent("node_modules", true),
          createDirent("package.json", false),
        ]);
      }
      if (p === path.join(repoPath, "node_modules")) {
        return Promise.resolve([createDirent("pom.xml", false)]); // This should be ignored
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual(["npm"]); // Only npm from repo root
  });

  test("should handle case insensitivity for found filenames", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([
          createDirent("PACKAGE.JSON", false),
          createDirent("POM.XML", false),
        ]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result.sort()).toEqual(["maven", "npm"].sort());
  });

  test("should correctly identify unique managers if multiple indicator files for the same manager are found", async () => {
    mockReaddirAsync.mockImplementation((dirPath: fs.PathLike) => {
      if (dirPath === repoPath) {
        return Promise.resolve([
          createDirent("requirements.txt", false),
          createDirent("setup.py", false),
          createDirent("pyproject.toml", false),
        ]);
      }
      return Promise.resolve([]);
    });
    const result = await detectPackageManagers(repoPath);
    expect(result).toEqual(["pip"]);
  });

  test("complex scenario with mixed files, depths, and excluded dirs", async () => {
    mockReaddirAsync.mockImplementation((p: fs.PathLike) => {
      const dirPathStr = p.toString();
      if (dirPathStr === repoPath) {
        return Promise.resolve([
          createDirent("package.json", false), // npm (depth 0)
          createDirent("srcdir", true),
          createDirent(".git", true), // excluded
          createDirent("clientdir", true),
        ]);
      }
      if (dirPathStr === path.join(repoPath, "srcdir")) {
        // depth 1
        return Promise.resolve([
          createDirent("pom.xml", false), // maven (depth 1)
          createDirent("node_modules", true), // excluded
        ]);
      }
      if (dirPathStr === path.join(repoPath, "srcdir", "node_modules")) {
        // depth 2, but excluded path
        return Promise.resolve([createDirent("yarn.lock", false)]);
      }
      if (dirPathStr === path.join(repoPath, "clientdir")) {
        // depth 1
        return Promise.resolve([createDirent("level2dir", true)]);
      }
      if (dirPathStr === path.join(repoPath, "clientdir", "level2dir")) {
        // depth 2
        return Promise.resolve([
          createDirent("requirements.txt", false), // pip (depth 2)
          createDirent("deepdir", true),
        ]);
      }
      if (
        dirPathStr === path.join(repoPath, "clientdir", "level2dir", "deepdir")
      ) {
        // depth 3 (now included with MAX_DEPTH = 3)
        return Promise.resolve([
          createDirent("go.mod", false), // go at depth 3
          createDirent("level4dir", true),
        ]);
      }
      if (
        dirPathStr ===
        path.join(repoPath, "clientdir", "level2dir", "deepdir", "level4dir")
      ) {
        // depth 4 (too deep, should be ignored)
        return Promise.resolve([createDirent("cargo.toml", false)]);
      }
      return Promise.resolve([]);
    });

    const result = await detectPackageManagers(repoPath);
    // Expected: npm (root), maven (srcdir), pip (clientdir/level2dir), go (clientdir/level2dir/deepdir)
    // MAX_DEPTH is 3, meaning depths 0, 1, 2, 3 are scanned.
    // - package.json at depth 0 -> npm
    // - pom.xml at depth 1 (in srcdir) -> maven
    // - .git at depth 0 is excluded.
    // - node_modules in srcdir is excluded.
    // - requirements.txt at depth 2 (in clientdir/level2dir) -> pip
    // - go.mod at depth 3 (in clientdir/level2dir/deepdir) -> go (now included!)
    // - cargo.toml at depth 4 is too deep (ignored)
    expect(result.sort()).toEqual(["go", "maven", "npm", "pip"].sort());
  });
});

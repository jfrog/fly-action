// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import {
  compileFilePattern,
  FileMatchPattern,
  getErrorMessage,
  normalizeToArray,
} from "./utils";

// Define constants at the module level for clarity and potential reuse.
const PACKAGE_MANAGER_FILE_IDENTIFIERS = [
  // Node.js ecosystem - specific lock files first, then package.json for npm
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: ["package.json", "package-lock.json"], manager: "npm" },

  // Python ecosystem - forgiving detection allows multiple managers from same files
  { file: ["poetry.lock", "pyproject.toml"], manager: "poetry" },
  { file: ["pipfile", "pipfile.lock"], manager: "pipenv" },
  { file: ["requirements.txt", "setup.py", "pyproject.toml"], manager: "pip" },
  { file: ["setup.py", "pyproject.toml", ".pypirc"], manager: "twine" },

  // .NET ecosystem
  {
    file: [
      "*.csproj",
      "*.fsproj",
      "*.vbproj",
      "global.json",
      "directory.build.props",
      "packages.config",
    ],
    manager: "dotnet",
  },
  { file: "*.nuspec", manager: "nuget" },

  // Java ecosystem
  { file: "pom.xml", manager: "maven" },
  { file: ["build.gradle", "build.gradle.kts"], manager: "gradle" },

  // Ruby
  { file: "gemfile", manager: "rubygems" },

  // Go
  { file: ["go.mod", "go.sum"], manager: "go" },

  // PHP
  { file: "composer.json", manager: "composer" },

  // Containers - docker and podman can both be detected from same files
  {
    file: ["dockerfile", "docker-compose.yml", "docker-compose.yaml"],
    manager: "docker",
  },
  {
    file: [
      "dockerfile",
      "containerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
    ],
    manager: "podman",
  },

  // Kubernetes
  {
    file: [
      "helmfile.yaml",
      "helmfile.yml",
      "chart.yaml",
      "Chart.yaml",
      "values.yaml",
    ],
    manager: "helm",
  },

  // Rust
  { file: "cargo.toml", manager: "cargo" },
] as const;

const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".github",
  "dist",
  "lib",
  "bin",
  "coverage",
  ".vscode",
  ".idea",
  "target",
  "build",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".env",
  "site-packages",
]);

// Maximum depth to scan for package manager files.
const MAX_PACKAGE_MANAGER_SCAN_DEPTH = 3;

/**
 * Associates a package manager with its pre-compiled file patterns.
 */
interface PackageManagerMatcher {
  manager: string;
  filePatterns: FileMatchPattern[];
}

/**
 * Compiles all file patterns into optimized matchers.
 */
function compileFilePatternMatchers(): PackageManagerMatcher[] {
  return PACKAGE_MANAGER_FILE_IDENTIFIERS.map((identifier) => {
    // Normalize the file patterns to an array of strings
    // The package manager file identifiers can be a single string or an array of strings
    // We need to normalize it to an array of strings so we can map over it
    const filenames = normalizeToArray(identifier.file);
    // Compile the file patterns to an array of FileMatchPattern objects
    // This is a performance optimization to avoid creating RegExp objects repeatedly during directory scanning.
    const compiledPatterns = filenames.map(compileFilePattern);

    return {
      manager: identifier.manager,
      filePatterns: compiledPatterns,
    };
  });
}

/** Pre-compiles all file pattern matchers once at module load time for performance
 * This avoids creating RegExp objects repeatedly during directory scanning.
 *
 * Performance optimization: Patterns are compiled once when the module loads,
 * then reused for every file check during package manager detection.
 */
const PACKAGE_MANAGER_FILE_MATCHERS = compileFilePatternMatchers();

/**
 * Checks if a file matches any package manager patterns and updates the found set.
 * Uses pre-compiled matchers for efficient pattern matching.
 *
 * @param fileName - The name of the file to check
 * @param filePath - The full path to the file (for logging)
 * @param foundManagers - Set to update with detected package managers
 */
function checkFileForPackageManager(
  fileName: string,
  filePath: string,
  foundManagers: Set<string>,
): void {
  const fileNameLower = fileName.toLowerCase();

  for (const matcher of PACKAGE_MANAGER_FILE_MATCHERS) {
    // Skip if we already detected this package manager
    if (foundManagers.has(matcher.manager)) {
      continue;
    }

    // Check if any file pattern matches this file
    const isMatch = matcher.filePatterns.some((pattern) => {
      if (pattern.regex) {
        // Use pre-compiled regex for wildcard patterns (e.g., *.csproj)
        return pattern.regex.test(fileName);
      }
      // Use exact string comparison for non-wildcard patterns
      return fileNameLower === pattern.exactName;
    });

    if (isMatch) {
      core.debug(`Found ${matcher.manager} file: ${filePath}`);
      foundManagers.add(matcher.manager);
    }
  }
}

/**
 * Recursively scans directories for package manager files.
 * Uses parallel async operations for optimal performance.
 *
 * @param currentPath - The directory path to scan
 * @param depth - Current recursion depth
 * @param maxDepth - Maximum depth to recurse
 * @param excludedDirs - Set of directory names to skip
 * @param foundManagers - Set to accumulate detected package managers
 */
async function findFilesRecursive(
  currentPath: string,
  depth: number,
  maxDepth: number,
  excludedDirs: ReadonlySet<string>,
  foundManagers: Set<string>,
): Promise<void> {
  // Stop if we've reached maximum recursion depth
  if (depth > maxDepth) {
    core.debug(`Max depth ${maxDepth} reached at ${currentPath}`);
    return;
  }

  // Early exit optimization: stop if we've found all possible package managers
  const totalPossibleManagers = PACKAGE_MANAGER_FILE_MATCHERS.length;
  if (foundManagers.size >= totalPossibleManagers) {
    core.debug(
      `Early exit: Found all ${totalPossibleManagers} possible package managers, stopping search at ${currentPath}`,
    );
    return;
  }

  // Read directory entries with file type information
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    core.debug(
      `Error reading directory ${currentPath}: ${getErrorMessage(error)}`,
    );
    return;
  }

  // Process all entries in parallel for maximum performance
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(currentPath, entry.name);

      try {
        if (entry.isDirectory()) {
          // Skip excluded directories (node_modules, .git, etc.)
          if (excludedDirs.has(entry.name)) {
            core.debug(`Skipping excluded directory: ${entryPath}`);
            return;
          }
          // Recursively scan subdirectories in parallel
          await findFilesRecursive(
            entryPath,
            depth + 1,
            maxDepth,
            excludedDirs,
            foundManagers,
          );
        } else if (entry.isFile()) {
          // Check if this file indicates a package manager
          checkFileForPackageManager(entry.name, entryPath, foundManagers);
        }
      } catch (error) {
        core.debug(`Error processing ${entryPath}: ${getErrorMessage(error)}`);
      }
    }),
  );
}

/**
 * Detects package managers used in the repository by scanning for characteristic files.
 * Performs an async parallel directory scan up to MAX_DEPTH levels deep.
 *
 * @param repoPath - The root path of the repository to scan
 * @returns A promise that resolves to an array of detected package manager names
 *
 * @example
 * const managers = await detectPackageManagers('/path/to/repo');
 * // Returns: ['npm', 'docker', 'pip']
 */
export async function detectPackageManagers(
  repoPath: string,
): Promise<string[]> {
  const detectedManagers: Set<string> = new Set();

  core.debug(
    `Starting package manager detection in: ${repoPath} (max depth: ${MAX_PACKAGE_MANAGER_SCAN_DEPTH})`,
  );

  // Validate repository path exists
  if (!repoPath || !fs.existsSync(repoPath)) {
    core.warning(
      `Repository path (${repoPath}) not set or does not exist. Cannot detect package managers.`,
    );
    return [];
  }

  // Scan repository for package manager files
  await findFilesRecursive(
    repoPath,
    0,
    MAX_PACKAGE_MANAGER_SCAN_DEPTH,
    EXCLUDED_DIRS,
    detectedManagers,
  );

  // Convert Set to sorted array for consistent output
  const result = Array.from(detectedManagers).sort();

  // Log results
  if (result.length > 0) {
    core.info(`Detected package managers: ${result.join(", ")}`);
  } else {
    core.info("No package managers detected");
  }

  return result;
}

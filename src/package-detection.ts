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

/**
 * Supported standard package managers - always sent to fly-client (no detection needed).
 * The fly-client will attempt to configure all of these.
 *
 * These are sent without detection because their setup is fast and lightweight.
 * The fly-client will skip any that aren't installed on the system.
 */
export const SUPPORTED_PACKAGE_MANAGERS = [
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
] as const;

/**
 * Container-based package managers - these are detected from files.
 * Only detected container managers are sent to fly-client.
 *
 * Unlike standard package managers (which are always sent), container managers
 * are only sent when detected because:
 * 1. They take longer to set up and authenticate
 * 2. They require authentication during setup (e.g., docker login)
 * 3. Detecting them precisely avoids unnecessary setup overhead
 *
 * Detection is "forgiving" - e.g., Dockerfile triggers both docker AND podman
 * since Podman can use Dockerfiles as a drop-in replacement.
 */
const CONTAINER_PACKAGE_MANAGER_IDENTIFIERS = [
  // Docker - dockerfile and docker-compose files
  {
    file: ["dockerfile", "docker-compose.yml", "docker-compose.yaml"],
    manager: "docker",
  },
  // Podman - containerfile is podman-specific, but dockerfile and docker-compose also work with podman
  {
    file: [
      "dockerfile",
      "containerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
    ],
    manager: "podman",
  },
  // Helm - Kubernetes package manager
  {
    file: ["helmfile.yaml", "helmfile.yml", "chart.yaml", "values.yaml"],
    manager: "helm",
  },
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

// Maximum depth to scan for container package manager files.
const MAX_CONTAINER_SCAN_DEPTH = 3;

/**
 * Associates a package manager with its pre-compiled file patterns.
 */
interface PackageManagerMatcher {
  manager: string;
  filePatterns: FileMatchPattern[];
}

/**
 * Compiles all container file patterns into optimized matchers.
 */
function compileContainerPatternMatchers(): PackageManagerMatcher[] {
  return CONTAINER_PACKAGE_MANAGER_IDENTIFIERS.map((identifier) => {
    const filenames = normalizeToArray(identifier.file);
    const compiledPatterns = filenames.map(compileFilePattern);

    return {
      manager: identifier.manager,
      filePatterns: compiledPatterns,
    };
  });
}

/** Pre-compiles all container file pattern matchers once at module load time for performance */
const CONTAINER_PACKAGE_MANAGER_MATCHERS = compileContainerPatternMatchers();

/**
 * Checks if a file matches any container package manager patterns and updates the found set.
 * Uses pre-compiled matchers for efficient pattern matching.
 *
 * @param fileName - The name of the file to check
 * @param filePath - The full path to the file (for logging)
 * @param foundManagers - Set to update with detected container package managers
 */
function checkFileForContainerManager(
  fileName: string,
  filePath: string,
  foundManagers: Set<string>,
): void {
  const fileNameLower = fileName.toLowerCase();

  for (const matcher of CONTAINER_PACKAGE_MANAGER_MATCHERS) {
    // Skip if we already detected this package manager
    if (foundManagers.has(matcher.manager)) {
      continue;
    }

    // Check if any file pattern matches this file
    const isMatch = matcher.filePatterns.some((pattern) => {
      if (pattern.regex) {
        return pattern.regex.test(fileName);
      }
      return fileNameLower === pattern.exactName;
    });

    if (isMatch) {
      core.debug(`Found ${matcher.manager} file: ${filePath}`);
      foundManagers.add(matcher.manager);
    }
  }
}

/**
 * Recursively scans directories for container package manager files.
 * Uses parallel async operations for optimal performance.
 *
 * @param currentPath - The directory path to scan
 * @param depth - Current recursion depth
 * @param maxDepth - Maximum depth to recurse
 * @param excludedDirs - Set of directory names to skip
 * @param foundManagers - Set to accumulate detected container package managers
 */
async function findContainerFilesRecursive(
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

  // Early exit optimization: stop if we've found all possible container managers
  const totalPossibleManagers = CONTAINER_PACKAGE_MANAGER_MATCHERS.length;
  if (foundManagers.size >= totalPossibleManagers) {
    core.debug(
      `Early exit: Found all ${totalPossibleManagers} container package managers, stopping search at ${currentPath}`,
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
          await findContainerFilesRecursive(
            entryPath,
            depth + 1,
            maxDepth,
            excludedDirs,
            foundManagers,
          );
        } else if (entry.isFile()) {
          // Check if this file indicates a container package manager
          checkFileForContainerManager(entry.name, entryPath, foundManagers);
        }
      } catch (error) {
        core.debug(`Error processing ${entryPath}: ${getErrorMessage(error)}`);
      }
    }),
  );
}

/**
 * Detects container-based package managers (docker, podman, helm) by scanning for characteristic files.
 * Performs an async parallel directory scan up to MAX_CONTAINER_SCAN_DEPTH levels deep.
 *
 * @param repoPath - The root path of the repository to scan
 * @returns A promise that resolves to an array of detected container package manager names
 *
 * @example
 * const containers = await detectContainerManagers('/path/to/repo');
 * // Returns: ['docker', 'podman'] if dockerfile is found
 */
export async function detectContainerManagers(
  repoPath: string,
): Promise<string[]> {
  const detectedManagers: Set<string> = new Set();

  core.debug(
    `Starting container package manager detection in: ${repoPath} (max depth: ${MAX_CONTAINER_SCAN_DEPTH})`,
  );

  // Validate repository path exists
  if (!repoPath || !fs.existsSync(repoPath)) {
    core.warning(
      `Repository path (${repoPath}) not set or does not exist. Cannot detect container package managers.`,
    );
    return [];
  }

  // Scan repository for container package manager files
  await findContainerFilesRecursive(
    repoPath,
    0,
    MAX_CONTAINER_SCAN_DEPTH,
    EXCLUDED_DIRS,
    detectedManagers,
  );

  // Convert Set to sorted array for consistent output
  const result = Array.from(detectedManagers).sort();

  // Log results
  if (result.length > 0) {
    core.info(`Detected container package managers: ${result.join(", ")}`);
  } else {
    core.info("No container package managers detected");
  }

  return result;
}

/**
 * Gets all package managers to send to fly-client.
 * Combines all supported standard package managers with detected container managers.
 *
 * @param repoPath - The root path of the repository to scan for container managers
 * @returns A promise that resolves to an array of all package manager names to configure
 *
 * @example
 * const managers = await getAllPackageManagers('/path/to/repo');
 * // Returns: ['npm', 'pnpm', 'pip', ..., 'docker', 'helm']
 */
export async function getAllPackageManagers(
  repoPath: string,
): Promise<string[]> {
  const containerManagers = await detectContainerManagers(repoPath);

  // Combine supported standard managers with detected container managers
  const allManagers = [
    ...SUPPORTED_PACKAGE_MANAGERS,
    ...containerManagers,
  ].sort();

  core.info(`All package managers for fly-client: ${allManagers.join(", ")}`);

  return allManagers;
}

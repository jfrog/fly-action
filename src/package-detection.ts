// Copyright (c) JFrog Ltd. (2025)

import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";

// Define constants at the module level for clarity and potential reuse.
const PACKAGE_MANAGER_FILE_IDENTIFIERS = [
  // Node.js ecosystem - specific lock files first, then package.json for npm
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "package.json", manager: "npm" },

  // Python ecosystem - specific lock files/project files first
  { file: "poetry.lock", manager: "poetry" },
  { file: "pipfile", manager: "pipenv" },
  { file: ["requirements.txt", "setup.py", "pyproject.toml"], manager: "pip" },

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
  { file: "go.mod", manager: "go" },

  // PHP
  { file: "composer.json", manager: "composer" },

  // Containers
  {
    file: [
      "dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      "containerfile",
    ],
    manager: "docker",
  },

  // Kubernetes
  { file: ["helmfile.yaml", "helmfile.yml", "chart.yaml"], manager: "helm" },

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

const MAX_DEPTH = 3;

// Pre-compile regex patterns at module initialization for performance
interface CompiledPattern {
  regex?: RegExp;
  literal: string;
}

interface CompiledCheck {
  manager: string;
  patterns: CompiledPattern[];
}

/**
 * Pre-compiles regex patterns for file matching to avoid recreating them on every file check.
 * Converts wildcard patterns (e.g., "*.csproj") into RegExp objects at module initialization.
 */
function precompileFilePatternRegexes(): CompiledCheck[] {
  return PACKAGE_MANAGER_FILE_IDENTIFIERS.map((check) => {
    const filePatterns: string[] = Array.isArray(check.file)
      ? [...check.file]
      : [check.file];
    const patterns: CompiledPattern[] = filePatterns.map((pattern: string) => {
      const lowerPattern = pattern.toLowerCase();
      if (lowerPattern.startsWith("*.")) {
        // Pre-compile wildcard patterns into regex for fast matching
        const extension = lowerPattern.substring(1);
        return {
          regex: new RegExp(`^.*\\${extension}$`, "i"),
          literal: lowerPattern,
        };
      } else {
        return {
          literal: lowerPattern,
        };
      }
    });
    return {
      manager: check.manager,
      patterns,
    };
  });
}

// Pre-compile all file pattern regexes once at module load time for performance
const PRECOMPILED_FILE_PATTERN_REGEXES = precompileFilePatternRegexes();

/**
 * Check if a file matches any package manager patterns using pre-compiled regexes
 */
function checkFileForPackageManager(
  fileName: string,
  filePath: string,
  foundManagers: Set<string>,
): void {
  const fileNameLower = fileName.toLowerCase();

  for (const check of PRECOMPILED_FILE_PATTERN_REGEXES) {
    // Skip if we already found this manager
    if (foundManagers.has(check.manager)) {
      continue;
    }

    const matches = check.patterns.some((pattern) => {
      if (pattern.regex) {
        // Use pre-compiled regex for wildcard patterns
        return pattern.regex.test(fileName);
      } else {
        // Simple string comparison for exact matches
        return fileNameLower === pattern.literal;
      }
    });

    if (matches) {
      core.debug(`Found ${check.manager} file: ${filePath}`);
      foundManagers.add(check.manager);
    }
  }
}

/**
 * Recursively search for package manager files
 */
async function findFilesRecursive(
  currentPath: string,
  depth: number,
  maxDepth: number,
  excludedDirs: ReadonlySet<string>,
  foundManagers: Set<string>,
): Promise<void> {
  if (depth > maxDepth) {
    core.debug(`Max depth ${maxDepth} reached at ${currentPath}`);
    return;
  }

  // Early exit: stop searching if we've found all possible package managers
  const totalPossibleManagers = PRECOMPILED_FILE_PATTERN_REGEXES.length;
  if (foundManagers.size >= totalPossibleManagers) {
    core.debug(
      `Early exit: Found all ${totalPossibleManagers} possible package managers, stopping search at ${currentPath}`,
    );
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    core.debug(
      `Error reading directory ${currentPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  // Process all entries in parallel for maximum performance
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(currentPath, entry.name);

      try {
        if (entry.isDirectory()) {
          if (excludedDirs.has(entry.name)) {
            core.debug(`Skipping excluded directory: ${entryPath}`);
            return;
          }
          // Recursively search subdirectories in parallel
          await findFilesRecursive(
            entryPath,
            depth + 1,
            maxDepth,
            excludedDirs,
            foundManagers,
          );
        } else if (entry.isFile()) {
          // Check if this file matches any package manager
          checkFileForPackageManager(entry.name, entryPath, foundManagers);
        }
      } catch (error) {
        core.debug(
          `Error processing ${entryPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
}

/**
 * Detects package managers used in the repository.
 * @param repoPath The root path of the repository.
 * @returns A promise that resolves to an array of detected package manager names.
 */
export async function detectPackageManagers(
  repoPath: string,
): Promise<string[]> {
  const detected: Set<string> = new Set();

  core.debug(
    `Detecting package managers in: ${repoPath}, max depth: ${MAX_DEPTH}`,
  );
  if (!repoPath || !fs.existsSync(repoPath)) {
    core.warning(
      `GITHUB_WORKSPACE (${repoPath}) not set or does not exist. Cannot detect package managers.`,
    );
    return [];
  }

  await findFilesRecursive(repoPath, 0, MAX_DEPTH, EXCLUDED_DIRS, detected);

  const result = Array.from(detected);
  if (result.length > 0) {
    core.info(`Detected package managers: ${result.join(", ")}`);
  } else {
    core.info("Detected package managers: none");
  }
  return result;
}

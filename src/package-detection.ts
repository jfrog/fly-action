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

const MAX_DEPTH = 2;

function findFilesRecursive(
  currentPath: string,
  depth: number,
  maxDepth: number,
  excludedDirs: ReadonlySet<string>,
  foundManagers: Set<string>,
  checks: typeof PACKAGE_MANAGER_FILE_IDENTIFIERS,
) {
  if (depth > maxDepth) {
    core.debug(`Max depth ${maxDepth} reached at ${currentPath}`);
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch (error) {
    core.debug(
      `Error reading directory ${currentPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);
    let stats;
    try {
      stats = fs.statSync(entryPath);
    } catch (error) {
      core.debug(
        `Error getting stats for ${entryPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    if (stats.isDirectory()) {
      if (excludedDirs.has(entry.name)) {
        core.debug(`Skipping excluded directory: ${entryPath}`);
        continue;
      }
      findFilesRecursive(
        entryPath,
        depth + 1,
        maxDepth,
        excludedDirs,
        foundManagers,
        checks,
      );
    } else if (stats.isFile()) {
      const fileNameLower = entry.name.toLowerCase();
      for (const check of checks) {
        const patterns = Array.isArray(check.file) ? check.file : [check.file];
        if (
          patterns.some((pattern: string) => {
            const lowerPattern = pattern.toLowerCase();
            if (lowerPattern.startsWith("*.")) {
              const regexPattern = new RegExp(
                // Construct regex: .*\.ext$ - e.g. .*\.csproj$
                // We need to escape the dot in the extension.
                // entry.name is used here as regex can handle case insensitivity itself.
                `^.*\\${lowerPattern.substring(1)}$`,
                "i", // Case-insensitive match
              );
              return regexPattern.test(entry.name);
            } else {
              return fileNameLower.endsWith(lowerPattern);
            }
          })
        ) {
          if (!foundManagers.has(check.manager)) {
            core.debug(`Found ${check.manager} file: ${entryPath}`);
            foundManagers.add(check.manager);
          }
        }
      }
    }
  }
}

/**
 * Detects package managers used in the repository.
 * @param repoPath The root path of the repository.
 * @returns An array of detected package manager names.
 */
export function detectPackageManagers(repoPath: string): string[] {
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

  findFilesRecursive(repoPath, 0, MAX_DEPTH, EXCLUDED_DIRS, detected, PACKAGE_MANAGER_FILE_IDENTIFIERS);

  const result = Array.from(detected);
  if (result.length > 0) {
    core.info(`Detected package managers: ${result.join(", ")}`);
  } else {
    core.info("Detected package managers: none");
  }
  return result;
}

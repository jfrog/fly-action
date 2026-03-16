// Copyright (c) JFrog Ltd. (2025)

/**
 * Supported standard package managers - always configured by fly-client.
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

// Copyright (c) JFrog Ltd. (2025)
//
// Port of fly-service/service/internal/graphql/artifactpath/artifact_path.go
// Parses Artifactory deployment paths to extract logical package names and versions.

import { CollectedArtifact } from "./types";

export interface ResolvedArtifact {
  name: string;
  version: string;
  type: string;
}

/**
 * Extracts the logical package name and version from a CollectedArtifact's
 * deployment path. An empty version signals the caller should filter out
 * the artifact (e.g. Docker sha256 digest, Maven metadata).
 */
export function resolveArtifact(artifact: CollectedArtifact): ResolvedArtifact {
  const { name: artifactName, type: packageType, path: deployPath } = artifact;

  if (!deployPath) {
    return { name: artifactName, version: artifactName, type: packageType };
  }

  switch (packageType.toLowerCase()) {
    case "npm":
      return { ...parseNpmPath(deployPath, artifactName), type: packageType };
    case "docker":
    case "oci":
    case "helmoci":
      return {
        ...parseDockerPath(deployPath, artifactName),
        type: packageType,
      };
    case "maven":
      return { ...parseMavenPath(deployPath, artifactName), type: packageType };
    case "pypi":
      return { ...parsePyPIPath(deployPath, artifactName), type: packageType };
    case "nuget":
      return { ...parseNuGetPath(deployPath, artifactName), type: packageType };
    case "generic":
      return {
        ...parseGenericPath(deployPath, artifactName),
        type: packageType,
      };
    default:
      return { name: artifactName, version: artifactName, type: packageType };
  }
}

/**
 * Builds a canonical deduplication key for a resolved artifact.
 */
export function dedupKey(resolved: ResolvedArtifact): string {
  return `${resolved.type.toLowerCase()}:${resolved.name}:${resolved.version}`;
}

/**
 * Resolves, filters, and deduplicates a list of collected artifacts.
 * Filters out entries with empty versions (digests, metadata).
 * Deduplicates by (name, type, version).
 */
export function resolveAndDedup(
  artifacts: CollectedArtifact[],
): ResolvedArtifact[] {
  const seen = new Set<string>();
  const result: ResolvedArtifact[] = [];

  for (const artifact of artifacts) {
    const resolved = resolveArtifact(artifact);
    if (resolved.version === "") continue;

    const key = dedupKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }

  return result;
}

// --- Per-ecosystem path parsers ---

function parseNpmPath(
  deployPath: string,
  artifactName: string,
): { name: string; version: string } {
  const sepIdx = deployPath.indexOf("/-/");
  if (sepIdx < 0) return { name: artifactName, version: artifactName };

  const pkgName = deployPath.substring(0, sepIdx);
  if (!pkgName) return { name: artifactName, version: artifactName };

  const filename = deployPath.substring(deployPath.lastIndexOf("/") + 1);
  const version = extractVersionFromFilename(filename, pkgName);
  if (!version) return { name: pkgName, version: artifactName };

  return { name: pkgName, version };
}

function extractVersionFromFilename(filename: string, pkgName: string): string {
  const lastSlash = pkgName.lastIndexOf("/");
  const baseName = lastSlash >= 0 ? pkgName.substring(lastSlash + 1) : pkgName;

  const prefix = baseName + "-";
  if (!filename.startsWith(prefix)) return "";

  let rest = filename.substring(prefix.length);
  if (rest.endsWith(".tgz")) rest = rest.slice(0, -4);
  else if (rest.endsWith(".tar.gz")) rest = rest.slice(0, -7);

  return rest || "";
}

function parseDockerPath(
  deployPath: string,
  artifactName: string,
): { name: string; version: string } {
  const segments = deployPath.split("/");
  if (segments.length < 3) return { name: artifactName, version: artifactName };

  const tagOrDigest = segments[segments.length - 2];
  const imageName = segments.slice(0, segments.length - 2).join("/");
  if (!imageName) return { name: artifactName, version: artifactName };

  if (tagOrDigest.includes(":")) return { name: imageName, version: "" };

  return { name: imageName, version: tagOrDigest };
}

function parseMavenPath(
  deployPath: string,
  artifactName: string,
): { name: string; version: string } {
  const segments = deployPath.split("/");
  if (segments.length < 4) return { name: artifactName, version: artifactName };

  const filename = segments[segments.length - 1];
  const version = segments[segments.length - 2];
  const artifactId = segments[segments.length - 3];

  if (!filename.startsWith(artifactId + "-"))
    return { name: artifactName, version: "" };

  return { name: artifactId, version };
}

function parsePyPIPath(
  deployPath: string,
  artifactName: string,
): { name: string; version: string } {
  const segments = deployPath.split("/");
  if (segments.length < 3) return { name: artifactName, version: artifactName };

  const pkgName = segments.slice(0, segments.length - 2).join("/");
  const version = segments[segments.length - 2];
  if (!pkgName) return { name: artifactName, version: artifactName };

  return { name: pkgName, version };
}

function parseNuGetPath(
  deployPath: string,
  artifactName: string,
): { name: string; version: string } {
  const segments = deployPath.split("/");

  // Structured path: PackageName / Version / filename
  if (segments.length >= 3) {
    const pkgName = segments.slice(0, segments.length - 2).join("/");
    const version = segments[segments.length - 2];
    if (pkgName) return { name: pkgName, version };
  }

  // Flat filename: PackageName.Version.nupkg
  if (!artifactName.endsWith(".nupkg") && !artifactName.endsWith(".snupkg"))
    return { name: artifactName, version: artifactName };

  const name = artifactName.replace(/\.(nupkg|snupkg)$/, "");
  if (!name) return { name: artifactName, version: artifactName };

  const parts = name.split(".");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0 && parts[i][0] >= "0" && parts[i][0] <= "9") {
      const pkgName = parts.slice(0, i).join(".");
      const version = parts.slice(i).join(".");
      if (pkgName && version) return { name: pkgName, version };
      break;
    }
  }

  return { name: artifactName, version: artifactName };
}

function parseGenericPath(
  deployPath: string,
  artifactName: string,
): { name: string; version: string } {
  const trimmed = deployPath.replace(/^\//, "");
  const parts = trimmed.split("/");
  if (parts.length >= 2) return { name: parts[0], version: parts[1] };
  return { name: artifactName, version: artifactName };
}

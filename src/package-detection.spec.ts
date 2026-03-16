// Copyright (c) JFrog Ltd. (2025)

import { SUPPORTED_PACKAGE_MANAGERS } from "./package-detection";

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

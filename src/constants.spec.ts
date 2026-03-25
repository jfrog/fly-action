// Copyright (c) JFrog Ltd. (2025)

import {
  PLATFORM_MAP,
  ARCH_MAP,
  FLY_CLI_DOWNLOAD_BASE,
  DEFAULT_FLY_URL,
} from "./constants";

describe("constants", () => {
  it("should have valid platform mappings", () => {
    expect(PLATFORM_MAP).toHaveProperty("darwin");
    expect(PLATFORM_MAP).toHaveProperty("linux");
    expect(PLATFORM_MAP).toHaveProperty("win32");
  });

  it("should have valid arch mappings", () => {
    expect(ARCH_MAP).toHaveProperty("x64");
    expect(ARCH_MAP).toHaveProperty("arm64");
  });

  it("should have a valid CLI download base URL", () => {
    expect(FLY_CLI_DOWNLOAD_BASE).toContain("releases.jfrog.io");
    expect(FLY_CLI_DOWNLOAD_BASE).toContain("[RELEASE]");
  });

  it("should have a valid default Fly URL", () => {
    expect(DEFAULT_FLY_URL).toBe("https://fly.jfrog.ai");
  });
});

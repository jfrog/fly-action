// Copyright (c) JFrog Ltd. (2025)

import { vi, type Mock } from "vitest";
import { authenticateOidc } from "./oidc";
import * as core from "@actions/core";
import { HttpClient, HttpClientResponse } from "@actions/http-client";
import { IncomingHttpHeaders } from "http";

vi.mock("@actions/core", () => ({
  debug: vi.fn(),
  warning: vi.fn(),
  getIDToken: vi.fn(),
  setSecret: vi.fn(),
  info: vi.fn(),
  notice: vi.fn(),
  error: vi.fn(),
}));

describe("authenticateOidc", () => {
  let mockPost: Mock;
  beforeEach(() => {
    mockPost = vi.fn();
    vi.spyOn(HttpClient.prototype, "post").mockImplementation(mockPost);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("should authenticate and return accessToken", async () => {
    // Mock getIDToken
    (core.getIDToken as Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );
    // Mock HttpClient.post
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () =>
        JSON.stringify({
          access_token: "tokval",
          fly_tenant_url: "https://tenant.jfrog.io",
        }),
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    const result = await authenticateOidc("https://fly");
    expect(result).toEqual({
      accessToken: "tokval",
      flyTenantUrl: "https://tenant.jfrog.io",
    });
  });

  it("should succeed with 201 Created status and return accessToken", async () => {
    (core.getIDToken as Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 201, headers: {} as IncomingHttpHeaders },
      readBody: async () =>
        JSON.stringify({
          access_token: "fake-token",
          fly_tenant_url: "https://tenant.jfrog.io",
        }),
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    const result = await authenticateOidc("https://fly");
    expect(result.accessToken).toBe("fake-token");
    expect(result.flyTenantUrl).toBe("https://tenant.jfrog.io");
  });

  it("should throw if getIDToken fails", async () => {
    (core.getIDToken as Mock).mockResolvedValue(undefined);
    await expect(authenticateOidc("url")).rejects.toThrow(
      "Failed to obtain OIDC token",
    );
  });

  it("should throw if Fly OIDC returns non-200 status", async () => {
    (core.getIDToken as Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig", // Still need a valid-looking token for mocks even if not parsing user
    );
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 500, headers: {} as IncomingHttpHeaders },
      readBody: async () => "error body",
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await expect(authenticateOidc("https://fly")).rejects.toThrow(
      /OIDC failed 500: error body/, // Updated error message
    );
  });

  it("should throw if OIDC response does not contain fly_tenant_url", async () => {
    (core.getIDToken as Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => JSON.stringify({ access_token: "tokval" }),
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await expect(authenticateOidc("https://fly")).rejects.toThrow(
      "OIDC response did not contain fly_tenant_url",
    );
  });

  it("should throw if OIDC response does not contain an access token", async () => {
    (core.getIDToken as Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig", // Still need a valid-looking token for mocks
    );
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => JSON.stringify({}),
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await expect(authenticateOidc("https://fly")).rejects.toThrow(
      "OIDC response did not contain an access token",
    );
  });
});

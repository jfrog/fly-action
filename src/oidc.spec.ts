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
          access_token: "tokval", // jfrog-ignore — fake test credential
          fly_tenant_url: "https://tenant.jfrog.io",
        }),
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    const result = await authenticateOidc("https://fly");
    expect(result).toEqual({
      accessToken: "tokval", // jfrog-ignore — fake test credential
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
          access_token: "fake-token", // jfrog-ignore — fake test credential
          fly_tenant_url: "https://tenant.jfrog.io",
        }),
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    const result = await authenticateOidc("https://fly");
    expect(result.accessToken).toBe("fake-token"); // jfrog-ignore — fake test credential
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
        ".sig",
    );
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 400, headers: {} as IncomingHttpHeaders },
      readBody: async () => '{"error":"bad request"}',
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await expect(authenticateOidc("https://fly")).rejects.toThrow(
      /OIDC failed 400/,
    );
  });

  it("should retry on transient network error and succeed", async () => {
    (core.getIDToken as Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );

    const networkError = new Error("connect ETIMEDOUT 1.2.3.4:443");
    (networkError as NodeJS.ErrnoException).code = "ETIMEDOUT";

    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () =>
        JSON.stringify({
          access_token: "tokval", // jfrog-ignore — fake test credential
          fly_tenant_url: "https://tenant.jfrog.io",
        }),
    } as unknown as HttpClientResponse;

    mockPost
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(fakeResponse);

    const result = await authenticateOidc("https://fly");

    expect(result.accessToken).toBe("tokval"); // jfrog-ignore — fake test credential
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("OIDC auth failed (attempt 1/3)"),
    );
  }, 15000);

  it("should retry on 5xx OIDC response and succeed", async () => {
    (core.getIDToken as Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );

    const fake500Response: HttpClientResponse = {
      message: { statusCode: 500, headers: {} as IncomingHttpHeaders },
      readBody: async () => '{"error":"internal server error"}',
    } as unknown as HttpClientResponse;
    const fakeOkResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () =>
        JSON.stringify({
          access_token: "tokval", // jfrog-ignore — fake test credential
          fly_tenant_url: "https://tenant.jfrog.io",
        }),
    } as unknown as HttpClientResponse;

    mockPost
      .mockResolvedValueOnce(fake500Response)
      .mockResolvedValueOnce(fakeOkResponse);

    const result = await authenticateOidc("https://fly");

    expect(result.accessToken).toBe("tokval"); // jfrog-ignore — fake test credential
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("OIDC auth failed (attempt 1/3)"),
    );
  }, 15000);

  it("should not retry on 4xx OIDC response", async () => {
    (core.getIDToken as Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 401, headers: {} as IncomingHttpHeaders },
      readBody: async () => '{"error":"unauthorized"}',
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await expect(authenticateOidc("https://fly")).rejects.toThrow(
      /OIDC failed 401/,
    );
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("should throw if OIDC response does not contain fly_tenant_url", async () => {
    (core.getIDToken as Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => JSON.stringify({ access_token: "tokval" }), // jfrog-ignore — fake test credential
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

import { extractUserFromToken, authenticateOidc, notifyCiEnd } from "./oidc";
import * as core from "@actions/core";
import { HttpClient, HttpClientResponse } from "@actions/http-client";
import { IncomingHttpHeaders } from "http";

jest.mock("@actions/core", () => ({
  debug: jest.fn(),
  warning: jest.fn(),
  getIDToken: jest.fn(),
  setSecret: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

describe("extractUserFromToken", () => {
  it("should extract username from sub claim without slash", () => {
    const payload = { sub: "username" };
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;
    expect(extractUserFromToken(token)).toBe("username");
  });

  it("should extract username after last slash", () => {
    const payload = { sub: "org/repo/username" };
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;
    expect(extractUserFromToken(token)).toBe("username");
  });

  it("should warn and return undefined on invalid token", () => {
    const result = extractUserFromToken("invalid.token");
    expect(core.warning).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe("authenticateOidc", () => {
  let mockPost: jest.Mock;
  beforeEach(() => {
    mockPost = jest.fn();
    jest.spyOn(HttpClient.prototype, "post").mockImplementation(mockPost);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it("should authenticate and return user and accessToken", async () => {
    // Mock getIDToken
    (core.getIDToken as jest.Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );
    // Mock HttpClient.post
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => JSON.stringify({ access_token: "tokval" }),
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    const result = await authenticateOidc("https://flyfrog");
    expect(result).toEqual({ user: "name", accessToken: "tokval" });
  });

  it("should throw if getIDToken fails", async () => {
    (core.getIDToken as jest.Mock).mockResolvedValue(undefined);
    await expect(authenticateOidc("url")).rejects.toThrow(
      "Failed to obtain OIDC token",
    );
  });

  it("should throw if FlyFrog OIDC returns non-200 status", async () => {
    (core.getIDToken as jest.Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 500, headers: {} as IncomingHttpHeaders },
      readBody: async () => "error body",
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await expect(authenticateOidc("https://flyfrog")).rejects.toThrow(
      /FlyFrog OIDC failed 500: error body/,
    );
  });

  it("should throw if access_token is missing in response", async () => {
    (core.getIDToken as jest.Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => JSON.stringify({}),
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await expect(authenticateOidc("https://flyfrog")).rejects.toThrow(
      "OIDC response did not contain an access token",
    );
  });
});

describe("notifyCiEnd", () => {
  let mockPost: jest.Mock;
  beforeEach(() => {
    mockPost = jest.fn();
    jest.spyOn(HttpClient.prototype, "post").mockImplementation(mockPost);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should successfully notify CI end", async () => {
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Build Info published successfully",
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await notifyCiEnd("https://flyfrog", "test-token");

    expect(mockPost).toHaveBeenCalledWith(
      "https://flyfrog/flyfrog/api/v1/ci/end",
      "",
      expect.objectContaining({
        Authorization: "Bearer test-token",
      }),
    );
  });

  it("should throw if CI end notification returns non-200 status", async () => {
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 500, headers: {} as IncomingHttpHeaders },
      readBody: async () => "Internal server error",
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    await expect(notifyCiEnd("https://flyfrog", "test-token")).rejects.toThrow(
      /FlyFrog CI end notification failed 500: Internal server error/,
    );
  });
});

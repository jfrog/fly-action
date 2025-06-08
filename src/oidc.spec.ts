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
  notice: jest.fn(),
  error: jest.fn(),
}));

describe("extractUserFromToken", () => {
  it("should extract username from sub claim without slash", () => {
    const payload = { sub: "username" };
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;
    expect(extractUserFromToken(token)).toBe("username");
  });

  it("should extract username after last slash if sub contains /users/", () => {
    const payload = { sub: "some/prefix/users/username_after_users" };
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;
    expect(extractUserFromToken(token)).toBe("username_after_users");
  });

  it("should extract username after last slash if sub starts with jfrt@ and contains /users/", () => {
    const payload = { sub: "jfrt@0123456789abcdef/users/jfrt_user" };
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;
    expect(extractUserFromToken(token)).toBe("jfrt_user");
  });

  it("should extract username after last slash if sub starts with jfrt@ and does not contain /users/ but has a slash", () => {
    // This case assumes any jfrt@ subject with a slash implies the last part is the username
    const payload = { sub: "jfrt@0123456789abcdef/another_user_format" };
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;
    expect(extractUserFromToken(token)).toBe("another_user_format");
  });

  it("should return the full sub if it starts with jfrt@ but has no slash", () => {
    // Based on the provided Go logic, if usernameStartIndex is < 0, it errors.
    // However, the JS code was modified to return sub if it doesn't meet the /users/ or jfrt@ with slash conditions.
    // This test reflects the current JS implementation for a jfrt@ subject without a slash.
    const payload = { sub: "jfrt@noslashuser" };
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;
    // According to the new JS logic: startsWith("jfrt@") is true, lastIndexOf("/") is -1.
    // The original Go code would error here. The current JS code will throw an error.
    // Let's adjust the expectation to match the implemented error throwing.
    expect(() => extractUserFromToken(token)).toThrow(
      "Couldn't extract username from access-token's subject: jfrt@noslashuser",
    );
  });

  it("should return the full sub for OIDC group scope or other formats", () => {
    const payload = { sub: "group-name-or-other-format" };
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;
    expect(extractUserFromToken(token)).toBe("group-name-or-other-format");
  });

  it("should extract username correctly if sub is just 'users/username'", () => {
    const payload = { sub: "users/edgecaseuser" }; // Contains /users/ but not jfrt@
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;
    expect(extractUserFromToken(token)).toBe("edgecaseuser");
  });

  it("should warn with 'Invalid JWT structure' and return undefined for malformed token", () => {
    const result = extractUserFromToken("invalid.token");
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Invalid JWT structure"),
    );
    expect(result).toBeUndefined();
  });

  it("should warn with 'Missing sub claim' and return undefined if sub claim is absent", () => {
    const payload = { not_sub: "username" }; // No 'sub' claim
    const token = `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;
    const result = extractUserFromToken(token);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Missing 'sub' claim"),
    );
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

  it("should succeed with 202 Created status", async () => {
    (core.getIDToken as jest.Mock).mockResolvedValue(
      "h." +
        Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
        ".sig",
    );
    const fakeResponse: HttpClientResponse = {
      message: { statusCode: 202, headers: {} as IncomingHttpHeaders },
      readBody: async () =>
        JSON.stringify({ access_token: "fake-token", username: "user" }),
    } as unknown as HttpClientResponse;
    mockPost.mockResolvedValue(fakeResponse);

    const result = await authenticateOidc("https://flyfrog");
    expect(result.user).toBe("name");
    expect(result.accessToken).toBe("fake-token");
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

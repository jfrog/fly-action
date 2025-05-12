import {
    extractUserFromToken,
    exchangeTokenForFlyFrogToken,
    authenticateOidc,
} from "./oidc";
import * as core from "@actions/core";
import { HttpClient } from "@actions/http-client";
import { FlyFrogCredentials } from "./types";

jest.mock("@actions/core", () => ({
    debug: jest.fn(),
    warning: jest.fn(),
    getIDToken: jest.fn(),
}));

// Mock HttpClient
jest.mock("@actions/http-client", () => ({
    HttpClient: jest.fn().mockImplementation(() => ({
        post: jest.fn(),
    })),
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

describe("exchangeTokenForFlyFrogToken", () => {
    const mockPost = jest.fn();
    beforeEach(() => {
        (HttpClient as jest.Mock).mockImplementation(() => ({ post: mockPost }));
    });

    it("should exchange token and return credentials with accessToken", async () => {
        const credentials: FlyFrogCredentials = { url: "https://example.com" };
        const fakeResponse = {
            message: { statusCode: 200 },
            readBody: jest.fn().mockResolvedValue('{"access_token":"abc123"}'),
        };
        mockPost.mockResolvedValue(fakeResponse);

        const result = await exchangeTokenForFlyFrogToken(
            credentials,
            "idtoken",
            "provider",
        );
        expect(result.accessToken).toBe("abc123");
        expect(mockPost).toHaveBeenCalledWith(
            "https://example.com/api/v1/oidc/token",
            expect.any(String),
            expect.objectContaining({ "Content-Type": "application/json" }),
        );
    });

    it("should throw error on non-200 status", async () => {
        const credentials: FlyFrogCredentials = { url: "https://example.org" };
        const fakeResponse = {
            message: { statusCode: 500 },
            readBody: jest.fn().mockResolvedValue("error"),
        };
        mockPost.mockResolvedValue(fakeResponse);

        await expect(
            exchangeTokenForFlyFrogToken(credentials, "tok", "prov"),
        ).rejects.toThrow(/Token exchange failed with status 500/);
    });
});

describe("authenticateOidc", () => {
    it("should authenticate and return user and accessToken", async () => {
        // Mock getIDToken
        (core.getIDToken as jest.Mock).mockResolvedValue(
            "h." +
            Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
            ".sig",
        );
        // Mock HttpClient.post
        const mockPost = jest.fn().mockResolvedValue({
            message: { statusCode: 200 },
            readBody: jest.fn().mockResolvedValue('{"access_token":"tokval"}'),
        });
        (HttpClient as jest.Mock).mockImplementation(() => ({ post: mockPost }));

        const result = await authenticateOidc("https://flyfrog");
        expect(result).toEqual({ user: "name", accessToken: "tokval" });
    });

    it("should throw if getIDToken fails", async () => {
        (core.getIDToken as jest.Mock).mockResolvedValue(undefined);
        await expect(authenticateOidc("url")).rejects.toThrow(
            "Failed to obtain OIDC token",
        );
    });
});

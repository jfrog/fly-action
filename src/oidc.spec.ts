import { extractUserFromToken, authenticateOidc } from "./oidc";
import * as core from "@actions/core";
import { HttpClient } from "@actions/http-client";

jest.mock("@actions/core", () => ({
    debug: jest.fn(),
    warning: jest.fn(),
    getIDToken: jest.fn(),
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
    let mockPostJson: jest.Mock;
    beforeEach(() => {
        mockPostJson = jest.fn();
        jest
            .spyOn(HttpClient.prototype, "postJson")
            .mockImplementation(mockPostJson);
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
        // Mock HttpClient.postJson
        const fakeResponse = {
            statusCode: 200,
            result: { access_token: "tokval" },
        };
        mockPostJson.mockResolvedValue(fakeResponse);

        const result = await authenticateOidc("https://flyfrog");
        expect(result).toEqual({ user: "name", accessToken: "tokval" });
    });

    it("should throw if getIDToken fails", async () => {
        (core.getIDToken as jest.Mock).mockResolvedValue(undefined);
        await expect(authenticateOidc("url")).rejects.toThrow(
            "Failed to obtain OIDC token",
        );
    });

    it("should throw if token exchange returns non-200 status", async () => {
        (core.getIDToken as jest.Mock).mockResolvedValue(
            "h." +
            Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
            ".sig",
        );
        const fakeResponse = {
            statusCode: 500,
            result: "error body",
        };
        mockPostJson.mockResolvedValue(fakeResponse);

        await expect(authenticateOidc("https://flyfrog")).rejects.toThrow(
            /Token exchange failed 500: error body/,
        );
    });

    it("should throw if access_token is missing in response", async () => {
        (core.getIDToken as jest.Mock).mockResolvedValue(
            "h." +
            Buffer.from(JSON.stringify({ sub: "owner/name" })).toString("base64") +
            ".sig",
        );
        const fakeResponse = {
            statusCode: 200,
            result: {},
        };
        mockPostJson.mockResolvedValue(fakeResponse);

        await expect(authenticateOidc("https://flyfrog")).rejects.toThrow(
            "Token response did not contain an access token",
        );
    });
});

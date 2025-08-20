import { authenticateOidc } from './oidc';
import * as core from '@actions/core';
import { HttpClient, HttpClientResponse } from '@actions/http-client';
import { IncomingHttpHeaders } from 'http';

jest.mock('@actions/core', () => ({
	debug: jest.fn(),
	warning: jest.fn(),
	getIDToken: jest.fn(),
	setSecret: jest.fn(),
	info: jest.fn(),
	notice: jest.fn(),
	error: jest.fn(),
}));

describe('authenticateOidc', () => {
	let mockPost: jest.Mock;
	beforeEach(() => {
		mockPost = jest.fn();
		jest.spyOn(HttpClient.prototype, 'post').mockImplementation(mockPost);
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});
	it('should authenticate and return accessToken', async () => {
		// Mock getIDToken
		(core.getIDToken as jest.Mock).mockResolvedValue(
			'h.' +
				Buffer.from(JSON.stringify({ sub: 'owner/name' })).toString('base64') +
				'.sig'
		);
		// Mock HttpClient.post
		const fakeResponse: HttpClientResponse = {
			message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
			readBody: async () => JSON.stringify({ access_token: 'tokval' }),
		} as unknown as HttpClientResponse;
		mockPost.mockResolvedValue(fakeResponse);

		const result = await authenticateOidc('https://fly');
		expect(result).toEqual({ accessToken: 'tokval' }); // Updated expectation
	});

	it('should succeed with 201 Created status and return accessToken', async () => {
		(core.getIDToken as jest.Mock).mockResolvedValue(
			'h.' +
				Buffer.from(JSON.stringify({ sub: 'owner/name' })).toString('base64') +
				'.sig'
		);
		const fakeResponse: HttpClientResponse = {
			message: { statusCode: 201, headers: {} as IncomingHttpHeaders },
			readBody: async () => JSON.stringify({ access_token: 'fake-token' }), // Removed username from mock response
		} as unknown as HttpClientResponse;
		mockPost.mockResolvedValue(fakeResponse);

		const result = await authenticateOidc('https://fly');
		expect(result.accessToken).toBe('fake-token'); // Updated expectation
	});

	it('should throw if getIDToken fails', async () => {
		(core.getIDToken as jest.Mock).mockResolvedValue(undefined);
		await expect(authenticateOidc('url')).rejects.toThrow(
			'Failed to obtain OIDC token'
		);
	});

	it('should throw if Fly OIDC returns non-200 status', async () => {
		(core.getIDToken as jest.Mock).mockResolvedValue(
			'h.' +
				Buffer.from(JSON.stringify({ sub: 'owner/name' })).toString('base64') +
				'.sig' // Still need a valid-looking token for mocks even if not parsing user
		);
		const fakeResponse: HttpClientResponse = {
			message: { statusCode: 500, headers: {} as IncomingHttpHeaders },
			readBody: async () => 'error body',
		} as unknown as HttpClientResponse;
		mockPost.mockResolvedValue(fakeResponse);

		await expect(authenticateOidc('https://fly')).rejects.toThrow(
			/OIDC failed 500: error body/ // Updated error message
		);
	});

	it('should throw if OIDC response does not contain an access token', async () => {
		(core.getIDToken as jest.Mock).mockResolvedValue(
			'h.' +
				Buffer.from(JSON.stringify({ sub: 'owner/name' })).toString('base64') +
				'.sig' // Still need a valid-looking token for mocks
		);
		const fakeResponse: HttpClientResponse = {
			message: { statusCode: 200, headers: {} as IncomingHttpHeaders },
			readBody: async () => JSON.stringify({}),
		} as unknown as HttpClientResponse;
		mockPost.mockResolvedValue(fakeResponse);

		await expect(authenticateOidc('https://fly')).rejects.toThrow(
			'OIDC response did not contain an access token'
		);
	});
});

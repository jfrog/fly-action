import * as core from '@actions/core';
import * as http from '@actions/http-client';
import { OidcAuthResult, FlyOidcRequest, FlyOidcResponse } from './types';
import { OutgoingHttpHeaders } from 'http';

// Represents the JSON body of the token exchange response
type TokenJson = { access_token?: string; [key: string]: unknown };

/**
 * Gets an OIDC token from the GitHub Actions runtime
 * @returns The OIDC token or undefined if the request failed
 */
export async function getIDToken(): Promise<string | undefined> {
	try {
		core.debug('Fetching OIDC token from GitHub');
		return await core.getIDToken();
	} catch (error) {
		core.warning(
			`Failed to get OIDC token: ${error instanceof Error ? error.message : String(error)}`
		);
		return undefined;
	}
}

/**
 * Performs full OIDC authentication with Fly, returning the access token
 * @param url The Fly server URL
 */
export async function authenticateOidc(url: string): Promise<OidcAuthResult> {
	const idToken = await getIDToken();
	if (!idToken) throw new Error('Failed to obtain OIDC token');
	// Mask the raw ID token in logs
	core.setSecret(idToken);

	const client = new http.HttpClient('fly-action');
	const oidcUrl = `${url}/fly/api/v1/ci/start-oidc`;
	core.debug(`Authenticating with Fly OIDC at ${oidcUrl}`);

	// Build the Fly OIDC request payload
	const payload: FlyOidcRequest = {
		subject_token: idToken,
	};

	const headers: OutgoingHttpHeaders = {
		[http.Headers.ContentType]: http.MediaTypes.ApplicationJson,
		[http.Headers.Accept]: http.MediaTypes.ApplicationJson,
	};

	const rawResponse = await client.post(
		oidcUrl,
		JSON.stringify(payload),
		headers
	);
	const body = await rawResponse.readBody();
	// Parse JSON to mask access_token and register secret
	let parsedJson: TokenJson;
	try {
		parsedJson = JSON.parse(body);
		if (parsedJson.access_token) {
			core.setSecret(parsedJson.access_token);
		}
	} catch {
		parsedJson = {};
	}
	const maskedResponse = parsedJson.access_token
		? { ...parsedJson, access_token: '***' }
		: parsedJson;
	// Log response details
	core.debug(
		`OIDC response headers: ${JSON.stringify(rawResponse.message.headers)}`
	);
	// Log success or error and throw on non-success status
	if (
		rawResponse.message.statusCode === http.HttpCodes.OK ||
		rawResponse.message.statusCode === 201
	) {
		core.debug(`OIDC authentication successful`);
		core.debug(`OIDC response body: ${JSON.stringify(maskedResponse)}`);
	} else {
		core.error(
			`OIDC failed ${rawResponse.message.statusCode}, body: ${JSON.stringify(
				maskedResponse
			)}`
		);
		throw new Error(`OIDC failed ${rawResponse.message.statusCode}: ${body}`);
	}
	const parsed = parsedJson as FlyOidcResponse;
	if (!parsed || !parsed.access_token) {
		throw new Error(
			`OIDC response did not contain an access token, body: ${body}`
		);
	}
	const accessToken = parsed.access_token;
	return { accessToken };
}

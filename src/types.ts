export interface OidcAuthResult {
  /** GitHub Actions user extracted from the OIDC token */
  user: string;
  /** Access token returned from FlyFrog token exchange */
  accessToken: string;
}

/** Payload for OIDC token exchange request */
export interface TokenExchangeRequest {
  grant_type: string;
  subject_token_type: string;
  subject_token: string;
  provider_name: string;
}

/** Response shape for OIDC token exchange */
export interface TokenExchangeResponse {
  access_token: string;
}

/** OAuth2 grant type for token exchange */
export const OIDC_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
/** Subject token type for OpenID Connect ID tokens */
export const OIDC_ID_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
/** OIDC provider name (used as user-agent and payload field) */
export const OIDC_PROVIDER_NAME = "flyfrog-action";

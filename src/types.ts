export interface OidcAuthResult {
  /** Access token returned from FlyFrog token exchange */
  accessToken: string;
}

/** Payload for FlyFrog OIDC authentication request */
export interface FlyFrogOidcRequest {
  subject_token: string;
}

/** Response shape for FlyFrog OIDC authentication */
export interface FlyFrogOidcResponse {
  access_token: string;
}

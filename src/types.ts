export interface OidcAuthResult {
  /** Access token returned from Fly token exchange */
  accessToken: string;
}

/** Payload for Fly OIDC authentication request */
export interface FlyOidcRequest {
  subject_token: string;
}

/** Response shape for Fly OIDC authentication */
export interface FlyOidcResponse {
  access_token: string;
}

/** Payload for the CI End notification */
export interface EndCiRequest {
  package_managers?: string[];
  status: string;
}

// Copyright (c) JFrog Ltd. (2025)

export interface OidcAuthResult {
  /** Access token returned from Fly token exchange */
  accessToken: string;
  /** Tenant-specific Fly URL resolved from OIDC claims (e.g. "https://flyjfrog.jfrog.io") */
  flyUrl?: string;
}

/** Payload for Fly OIDC authentication request */
export interface FlyOidcRequest {
  subject_token: string;
}

/** Response shape for Fly OIDC authentication */
export interface FlyOidcResponse {
  access_token: string;
  /** Resolved tenant URL when tenant was identified from OIDC claims (omitted when subdomain was used) */
  fly_url?: string;
}

/** Payload for the CI End notification */
export interface EndCiRequest {
  package_managers?: string[];
  status: string;
}

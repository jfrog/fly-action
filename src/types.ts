// Copyright (c) JFrog Ltd. (2025)

export interface OidcAuthResult {
  /** Access token returned from Fly token exchange */
  accessToken: string;
  /** Tenant-specific subdomain URL resolved from OIDC claims (e.g. "https://flyjfrog.jfrog.io") */
  flyTenantUrl: string;
}

/** Payload for Fly OIDC authentication request */
export interface FlyOidcRequest {
  subject_token: string;
}

/** Response shape for Fly OIDC authentication */
export interface FlyOidcResponse {
  access_token: string;
  /** Tenant subdomain URL resolved from OIDC claims — used for EndCi and fly-client so nginx injects tenant headers */
  fly_tenant_url: string;
}

/** Payload for the CI End notification */
export interface EndCiRequest {
  package_managers?: string[];
  status: string;
}

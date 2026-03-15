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

/**
 * Payload for the CI End notification.
 *
 * TODO: status and package_managers are ignored by the server since PR #624
 * (multi-job CI release support). Remove these fields and the package manager
 * detection in ci/start once all servers are upgraded.
 */
export interface EndCiRequest {
  package_managers?: string[];
  status: string;
}

/** A single artifact collected during the CI workflow */
export interface CollectedArtifact {
  name: string;
  type: string;
  repo_key?: string;
  path?: string;
}

/** Response from the CI End endpoint */
export interface EndCiResponse {
  artifacts: CollectedArtifact[];
}

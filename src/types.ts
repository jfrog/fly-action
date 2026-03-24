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

/** A single artifact collected during the CI workflow */
export interface CollectedArtifact {
  name: string;
  type: string;
  path?: string;
}

/** Response from the CI End endpoint */
export interface EndCiResponse {
  artifacts: CollectedArtifact[];
}

/**
 * JSON envelope written to stdout by every fly CLI command.
 * Mirrors Go type: client/internal/output/response.go → Response
 */
export interface FlyClientResponse {
  command: string;
  results: FlyClientResult[];
}

/**
 * A single item within a FlyClientResponse.
 * Mirrors Go type: client/internal/output/response.go → Result
 */
export interface FlyClientResult {
  name: string;
  status: "success" | "error" | "configured" | "not_configured";
  message?: string;
}

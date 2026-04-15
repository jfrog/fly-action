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

/** Parsed distribute input entry */
export interface DistributeEntry {
  name: string;
  version: string;
  type: string;
}

/** Request body for the Fly distribute endpoint */
export interface DistributeRequest {
  package_name: string;
  package_version: string;
  package_type: string;
}

/** Response body from the Fly distribute endpoint */
export interface DistributeResponse {
  package_name: string;
  package_version: string;
  package_type: string;
  public_url: string;
  download_url: string;
  download_count: number;
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

/**
 * One upload or download invocation's results, accumulated in
 * ENV_FLY_TRANSFER_RESULTS as JSON-lines so the post step can
 * render them in the job summary.
 */
export interface TransferSummaryEntry {
  type: "upload" | "download";
  name: string;
  version: string;
  results: FlyClientResult[];
}

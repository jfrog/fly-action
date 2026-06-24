// Copyright (c) JFrog Ltd. (2025)

export interface OidcAuthResult {
  /** Access token returned from Fly token exchange */
  accessToken: string;
  /** Tenant-specific subdomain URL resolved from OIDC claims (e.g. "https://flyjfrog.jfrog.io") */
  flyTenantUrl: string;
  /** Username from the OIDC token exchange (e.g. "fly-team+912@jfrog.com"). Used by fly-client for docker/helm login. */
  username?: string;
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
  /** Username associated with the exchanged token — needed by fly-client for docker/helm login with reference tokens */
  username?: string;
}

/** A single artifact collected during the CI workflow */
export interface CollectedArtifact {
  name: string;
  type: string;
  path?: string;
  timestamp?: number; // Unix epoch seconds when artifact was collected
  size?: number; // Content-Length in bytes (0 if unavailable)
}

/** Response from the CI End endpoint */
export interface EndCiResponse {
  artifacts: CollectedArtifact[];
}

/** Request body for the Fly distribute endpoint */
export interface DistributeRequest {
  package_name: string;
  package_version: string;
  package_type: string;
}

/**
 * One file within a distributed artifact version. Generic distributions have
 * one entry per uploaded file; Docker distributions have one entry per file
 * under the image tag (manifest + per-layer blobs).
 */
export interface DistributeResponseFile {
  package_name: string;
  package_version: string;
  file_name: string;
  /** Hex-encoded sha256 — omitted by the server when unavailable. */
  sha256?: string;
  download_count: number;
}

/** Response body from the Fly distribute endpoint */
export interface DistributeResponse {
  package_name: string;
  package_version: string;
  package_type: string;
  /**
   * Public namespace for the distribution. Generic:
   * `https://{tenant}/public/generic/{name}/{version}`. Docker:
   * `https://{tenant}/v2/docker-public/{image}`.
   */
  public_url: string;
  /**
   * Concrete pull URL. Generic: the first file under the version. Docker:
   * the manifest URL `https://{tenant}/v2/docker-public/{image}/manifests/{tag}`.
   */
  download_url: string;
  download_count: number;
  /**
   * Per-file breakdown. Optional for backward compatibility with older
   * fly-service revisions that did not emit this field.
   */
  files?: DistributeResponseFile[];
}

/**
 * Slim projection of {@link DistributeResponse} containing only the fields the
 * job-summary "Distributed Artifacts" table renders. This is what gets
 * persisted to the FLY_DISTRIBUTE_RESULTS env var across distribute steps.
 *
 * The full response carries an unbounded per-file `files[]` breakdown (plus
 * `download_count`s) that the summary never reads. Persisting the full object
 * grows the env var with every distribute call and can push it past the Linux
 * single-env-var limit (MAX_ARG_STRLEN, 128 KB), which makes the kernel reject
 * `execve` for every later step and post-cleanup with E2BIG. Keeping only the
 * rendered fields bounds the per-entry size. See issue #69.
 */
export interface DistributeSummaryEntry {
  package_name: string;
  package_version: string;
  package_type: string;
  public_url: string;
  download_url: string;
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
 * Slim per-file projection persisted in ENV_FLY_TRANSFER_RESULTS — only the
 * fields the transfers table renders (name + status). `message` is dropped on
 * purpose: the summary never shows it, and persisting it would grow the env var
 * with every transferred file across steps, risking the same E2BIG failure as
 * the distribute path (#69 / {@link DistributeSummaryEntry}).
 */
export interface TransferSummaryResult {
  name: string;
  status: FlyClientResult["status"];
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
  results: TransferSummaryResult[];
}

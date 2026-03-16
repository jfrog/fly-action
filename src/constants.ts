// Copyright (c) JFrog Ltd. (2025)

export const INPUT_URL = "url";
export const INPUT_IGNORE_PACKAGE_MANAGERS = "ignore";

// Central Fly endpoint for github.com runners.
// Tenant is resolved server-side from OIDC claims.
export const DEFAULT_FLY_URL = "https://fly.jfrog.ai";

// Environment variable that GHES organizations can set to specify their Fly endpoint.
// When running on GitHub Enterprise Server, the action reads this env var to determine
// where to send the OIDC token exchange request (e.g., "https://fly.jfrog.info").
// Named CUSTOM_FLY_URL to avoid collision with FLY_URL which the action sets
// internally for the fly CLI binary (resolved tenant URL).
export const ENV_FLY_URL = "CUSTOM_FLY_URL";

export const STATE_FLY_URL = "fly-url";
export const STATE_FLY_ACCESS_TOKEN = "fly-access-token";

// Environment variable to track if action has already run in this job
export const ENV_FLY_ACTION_CONFIGURED = "FLY_ACTION_CONFIGURED";

// Exported to GITHUB_ENV so subsequent steps can use ${{ env.FLY_REGISTRY_SUBDOMAIN }}
export const ENV_FLY_REGISTRY_SUBDOMAIN = "FLY_REGISTRY_SUBDOMAIN";

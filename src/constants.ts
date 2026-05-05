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
export const STATE_FLY_PLATFORM_URL = "fly-platform-url";

// Environment variable to track if action has already run in this job
export const ENV_FLY_ACTION_CONFIGURED = "FLY_ACTION_CONFIGURED";

// Exported to GITHUB_ENV so subsequent steps can use ${{ env.FLY_REGISTRY_SUBDOMAIN }}
export const ENV_FLY_REGISTRY_SUBDOMAIN = "FLY_REGISTRY_SUBDOMAIN";

// Runtime env vars exported to GITHUB_ENV by the root action so that
// sub-actions (upload/download) and user run: steps can use the fly CLI.
export const ENV_FLY_URL_RUNTIME = "FLY_URL";
export const ENV_FLY_ACCESS_TOKEN_RUNTIME = "FLY_ACCESS_TOKEN";
export const ENV_FLY_IGNORE_PACKAGE_MANAGERS = "FLY_IGNORE_PACKAGE_MANAGERS";

// Fly CLI binary download from Fly public generic endpoint.
// [LATEST] is an Artifactory token that resolves to the latest published version.
export const FLY_CLI_DOWNLOAD_BASE =
  "https://flyjfrog.jfrog.io/public/generic/fly-client/[LATEST]";

export const PLATFORM_MAP: Record<string, string> = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

export const ARCH_MAP: Record<string, string> = {
  x64: "amd64",
  arm64: "arm64",
};

export const UNIX_EXECUTABLE_MODE = 0o755;

// Action input name for distribute sub-action package type.
// Name and version inputs are shared with upload/download (INPUT_NAME, INPUT_VERSION).
export const INPUT_DISTRIBUTE_TYPE = "type";

// Env var used to accumulate distribute results across sub-action steps.
// Each invocation appends a JSON line; the post step reads and renders them.
export const ENV_FLY_DISTRIBUTE_RESULTS = "FLY_DISTRIBUTE_RESULTS";

// Action input names for upload/download sub-actions
export const INPUT_NAME = "name";
export const INPUT_VERSION = "version";
export const INPUT_FILES = "files";
export const INPUT_EXCLUDE = "exclude";
export const INPUT_OUTPUT_DIR = "output-dir";
export const INPUT_PATH = "path";

// Reserved version token. The fly server resolves `[LATEST]` to the most
// recently uploaded version on download via a 302 redirect (case-insensitive,
// also accepts `[latest]`, `[Latest]`). Reserved on write — the server
// rejects upload requests where `version=[LATEST]`.
export const LATEST_VERSION = "[LATEST]";

// Action output names
export const OUTPUT_RESULTS = "results";

// Fly CLI subcommands
export const CLI_CMD_UPLOAD = "upload";
export const CLI_CMD_DOWNLOAD = "download";
export const CLI_CMD_PUBLISH = "publish";
export const CLI_CMD_SETUP = "setup";
export const CLI_CMD_VERSION = "version";

// Fly CLI flag names (mirrors Go client/internal/constants/constants.go)
export const CLI_FLAG_NAME = "--name";
export const CLI_FLAG_VERSION = "--version";
export const CLI_FLAG_EXCLUDE = "--exclude";
export const CLI_FLAG_OUTPUT_DIR = "--output-dir";

// CLI response status values
export const STATUS_ERROR = "error";

// Default output directory for downloads
export const DEFAULT_OUTPUT_DIR = ".";

// Env var used to accumulate upload/download results across sub-action steps.
// Each invocation appends a JSON line; the post step reads and renders them.
export const ENV_FLY_TRANSFER_RESULTS = "FLY_TRANSFER_RESULTS";

// Version resolution
export const MAX_VERSION_LENGTH = 40;
export const FALLBACK_VERSION = "unknown";

// Error output truncation — prevents secrets or internal details from leaking
// into GitHub Actions logs via exception messages.
export const MAX_ERROR_OUTPUT_LENGTH = 500;

// Copyright (c) JFrog Ltd. (2025)

export const INPUT_URL = "url";
export const INPUT_IGNORE_PACKAGE_MANAGERS = "ignore";
export const INPUT_GITHUB_TOKEN = "github_token";

export const STATE_FLY_URL = "fly-url";
export const STATE_FLY_ACCESS_TOKEN = "fly-access-token";
export const STATE_FLY_PACKAGE_MANAGERS = "fly-package-managers";

// Environment variable to track if action has already run in this job
export const ENV_FLY_ACTION_CONFIGURED = "FLY_ACTION_CONFIGURED";

// GitHub step/job conclusion statuses
export const GITHUB_STATUS_SUCCESS = "success";
export const GITHUB_STATUS_FAILURE = "failure";
export const GITHUB_STATUS_CANCELLED = "cancelled";
export const GITHUB_STATUS_TIMED_OUT = "timed_out";

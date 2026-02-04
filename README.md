<div align="center">

# Fly Action

[![Scanned by Frogbot](https://raw.githubusercontent.com/jfrog/frogbot/refs/heads/master/images/frogbot-badge.svg)](https://docs.jfrog-applications.jfrog.io/jfrog-applications/frogbot)
[![docs](https://img.shields.io/badge/Docs-%F0%9F%93%96-blue)](https://docs.fly.jfrog.ai)

</div>

This GitHub Action downloads the Fly CLI and configures package managers to use Fly as a registry for dependencies.

For more information about JFrog Fly, see the [official documentation](https://docs.fly.jfrog.ai).

## Features

- ✅ Supports all package managers available in Fly CLI
- ✅ Configures all detected package managers with a single command
- ✅ OIDC authentication only
- ✅ Allows ignoring specific package managers
- ✅ Automatic CI session end notification to the Fly server
- ✅ Retry mechanism with exponential backoff for CI notifications

## Usage

```yaml
name: Build with Fly Registry
on: [push]

permissions:
  contents: read
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Setup Fly registry with OIDC
      - name: Setup Fly Registry
        uses: jfrog/fly-action@v1
        with:
          url: https://<your-fly-subdomain>.jfrog.io
          # ignore: docker,pip (optional)
```

### OIDC Authentication (Required)

This action requires OIDC authentication. The OIDC token is used to track uploads and downloads on the Fly server. You must set `permissions: id-token: write` in your workflow file.

```yaml
permissions:
  contents: read
  id-token: write # Required for OIDC authentication
  actions: read   # Optional: enables accurate job status detection
```

> **Note**: The `actions: read` permission is optional but recommended. Without it, the action cannot accurately detect whether the job succeeded or failed, and will assume success. With this permission, the action can check the status of individual workflow steps to report accurate job status to the Fly server.

#### Required Inputs

- `url`: Fly URL

#### Optional Inputs

- `ignore`: Comma-separated list of package managers to ignore (e.g., docker,pip)

## Inputs

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `url` | Fly URL | Yes | N/A |
| `ignore` | Comma-separated list of package managers to ignore | No | None |

## OIDC Authentication

When using OIDC authentication:

1. You need to set `permissions: id-token: write` in your workflow file
2. The action will:
   - Request an OIDC token from GitHub Actions
   - Exchange it for a Fly access token
   - Use the resulting token to authenticate with Fly
   - Automatically notify the Fly server when the CI session ends (using GitHub Actions post-job mechanism)

> **Note**: The CI end notification runs automatically as a post-job step. This ensures it executes even if the main action fails, for proper session management on the Fly server. If the CI end notification step itself encounters an error, it will cause the overall workflow to be marked as failed.

## Supported Package Managers

The action supports all package managers that the Fly CLI supports:

- **npm, pnpm, yarn** – Node.js package managers (npm registry)
- **pip, pipenv, poetry, twine** – Python package managers (PyPI repository)
- **nuget, dotnet** – .NET package managers (NuGet)
- **docker, podman** – Container registries (Docker)
- **helm** – Kubernetes package manager
- **go** – Go modules
- **gradle** – Gradle build tool
- **maven** – Maven build tool

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for information on development setup, testing, and publishing.

## License

This GitHub Action is licensed under the [Apache-2.0](LICENSE).

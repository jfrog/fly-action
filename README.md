<div align="center">

# Fly Action

[![Scanned by Frogbot](https://raw.githubusercontent.com/jfrog/frogbot/refs/heads/master/images/frogbot-badge.svg)](https://docs.jfrog-applications.jfrog.io/jfrog-applications/frogbot)

</div>

This GitHub Action downloads the Fly CLI and configures package managers to use Fly as a registry for dependencies.

## Features

- ✅ Supports all package managers available in Fly CLI
- ✅ Configures all detected package managers with a single command
- ✅ OIDC authentication only
- ✅ Allows ignoring specific package managers
- ✅ Automatic CI session end notification to the Fly server

## Usage

```yaml
name: Build with Fly Registry
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Setup Fly registry with OIDC
      - name: Setup Fly Registry
        uses: jfrog/fly-action@v1
        with:
          url: https://fly.example.com
          # ignore: docker,pip (optional)
```

### OIDC Authentication (Required)

This action only supports OIDC authentication for enhanced security. You must set `permissions: id-token: write` in your workflow file.

```yaml
permissions:
  id-token: write # Required for OIDC authentication
```

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

1. Your Fly server must support the OpenID Connect protocol and have a provider configured
2. You need to set `permissions: id-token: write` in your workflow file
3. The provider name is fixed to `fly-action`
4. The action will:
   - Request an OIDC token from GitHub Actions
   - Exchange it for a Fly access token via the `/fly/api/v1/ci/start-oidc` endpoint
   - Use the resulting token to authenticate with Fly
   - Automatically notify CI session end via the `/fly/api/v1/ci/end` endpoint when the job completes (using GitHub Actions post-job mechanism)

> **Note**: The CI end notification runs automatically as a post-job step. This ensures it executes even if the main action fails, for proper session management on the Fly server. If the CI end notification step itself encounters an error, it will cause the overall workflow to be marked as failed.

### Fly Server Configuration for OIDC

To use OIDC authentication, your Fly server must be configured with:

1. An OIDC provider that accepts GitHub Actions tokens
2. Custom Fly API endpoints:
   - `/fly/api/v1/ci/start-oidc` for token exchange and CI session initialization
   - `/fly/api/v1/ci/end` for CI session end notification
3. Custom audience claim support (if using non-default audience)

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

## Testing

### Integration Tests

Integration tests run automatically on pushes to the main branch, but require a valid Fly test server to be configured. The integration test will only run if the `FLY_TEST_URL` repository variable is set.

To configure integration testing:

1. Set up a Fly server that supports the required API endpoints
2. Set the `FLY_TEST_URL` repository variable in your GitHub repository settings
3. The integration test will automatically run on the next push

## Build Process

The action is built using `npm run build`. This command formats the code with Prettier, performs type checking using TypeScript (`tsc`), and then compiles and bundles `src/index.ts` and `src/post.ts` into single executable JavaScript files: `lib/index.js` and `lib/post.js`. These `lib/` files are what the GitHub Action executes.

A Husky pre-commit hook is configured to run `npm run build` automatically on each commit, ensuring that code is formatted, type-checked, and bundled before being committed.

## Building and Publishing

### Development Setup

To develop and test locally:

1. Clone the repository.
2. Install dependencies: `npm install` (this also runs Prettier via the `postinstall` hook).
3. Build: `npm run build` (this formats, type-checks TypeScript with `tsc`, and bundles the TypeScript source files into JavaScript for the action using `ncc`).
4. Run tests: `npm test`.

> A Husky pre-commit hook is configured—any `git commit` will trigger `npm run build` to ensure your code is formatted, compiled, and bundled before committing.

### Publishing a new version

- Ensure tests pass and build is up to date:

  ```bash
  npm test && npm run build
  ```

- Push changes to the default branch (e.g., `main`):

  ```bash
  git push origin main
  ```

- Draft a release in the GitHub UI:
  1. Go to the “Releases” page of your repository.
  2. Click **Draft a new release**.
  3. Set the tag name to `vX.Y.Z` (e.g., `v1.2.3`).
  4. Publish the release.

Once the release is published, the GitHub Actions workflow will:

1. Extract the version from the tag (`vX.Y.Z`).
2. Bump `package.json` and `package-lock.json` to `X.Y.Z`.
3. Commit and push the updated lockfile.
4. Update and force-push the `vX.Y` and `vX` tags.
5. Push all changes back to the repository.

## License

This GitHub Action is licensed under the [Apache-2.0](LICENSE).

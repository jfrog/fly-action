# flyfrog-action

This GitHub Action downloads the FlyFrog CLI and configures package managers to use FlyFrog as a registry for dependencies.

## Features

- ✅ Supports all package managers available in FlyFrog CLI (npm, pip, maven, dotnet, docker)
- ✅ Configures all detected package managers with a single command
- ✅ OIDC authentication only
- ✅ Allows ignoring specific package managers

## Usage

```yaml
name: Build with FlyFrog Registry
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      # Setup FlyFrog registry with OIDC
      - name: Setup FlyFrog Registry
        uses: jfrog/flyfrog-action@v1
        with:
          url: https://flyfrog.example.com
          # ignore: docker,pip (optional)
```

### OIDC Authentication (Required)

This action only supports OIDC authentication for enhanced security. You must set `permissions: id-token: write` in your workflow file.

```yaml
permissions:
  id-token: write # Required for OIDC authentication
```

#### Required Inputs
- `url`: FlyFrog URL

#### Optional Inputs
- `ignore`: Comma-separated list of package managers to ignore (e.g., docker,pip)

## Inputs

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `url` | FlyFrog URL | Yes | N/A |
| `ignore` | Comma-separated list of package managers to ignore | No | None |

## OIDC Authentication

When using OIDC authentication:

1. Your FlyFrog server must support the OpenID Connect protocol and have a provider configured
2. You need to set `permissions: id-token: write` in your workflow file
3. The provider name is fixed to `flyfrog-action`
4. The action will:
   - Request an OIDC token from GitHub Actions
   - Exchange it for a FlyFrog access token via the `/flyfrog/api/v1/ci/start-oidc` endpoint
   - Use the resulting token to authenticate with FlyFrog
   - Notify CI session end via the `/flyfrog/api/v1/ci/end` endpoint on completion

### FlyFrog Server Configuration for OIDC

To use OIDC authentication, your FlyFrog server must be configured with:

1. An OIDC provider that accepts GitHub Actions tokens
2. Custom FlyFrog API endpoints:
   - `/flyfrog/api/v1/ci/start-oidc` for token exchange and CI session initialization
   - `/flyfrog/api/v1/ci/end` for CI session end notification
3. Custom audience claim support (if using non-default audience)

## Supported Package Managers

The action supports all package managers that the FlyFrog CLI supports:

- **npm, pnpm, yarn** – Node.js package managers (npm registry)
- **pip, pipenv, poetry, twine** – Python package managers (PyPI repository)
- **nuget, dotnet** – .NET package managers (NuGet)
- **docker, podman** – Container registries (Docker)
- **go** – Go modules
- **gradle** – Gradle build tool
- **maven** – Maven build tool

## Testing

### Integration Tests

Integration tests run automatically on pushes to the main branch, but require a valid FlyFrog test server to be configured. The integration test will only run if the `FLYFROG_TEST_URL` repository variable is set.

To configure integration testing:

1. Set up a FlyFrog server that supports the required API endpoints
2. Set the `FLYFROG_TEST_URL` repository variable in your GitHub repository settings
3. The integration test will automatically run on the next push

### Testing FlyFrog Server Compatibility

Use the provided test script to validate that a FlyFrog server supports the required API endpoints:

```bash
./scripts/test-server.sh https://your-flyfrog-server.com
```

This script will test:
- Basic server connectivity
- OIDC start endpoint (`/flyfrog/api/v1/ci/start-oidc`)
- CI end notification endpoint (`/flyfrog/api/v1/ci/end`)

## Build Process

- npm install → formats code via postinstall hook
- npm run build → formats, compiles (tsc), bundles (ncc) to lib/index.js

- Note: `dist/` is the raw JS output from TS compilation; `lib/` is the final single-file bundle used by the action
- Husky pre-commit hook runs build on each commit

## Building and Publishing

### Development Setup

To develop and test locally:

1. Clone the repository.
2. Install dependencies: `npm install` (this automatically runs Prettier via the `postinstall` hook).
3. Build: `npm run build` (this runs `format`, compiles TypeScript via `tsc`, then bundles the dist file with `ncc`).
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

This GitHub Action is licensed under the [MIT License](LICENSE).
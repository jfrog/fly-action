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
   - Exchange it for a FlyFrog access token via the `/api/v1/oidc/token` endpoint
   - Use the resulting token to authenticate with FlyFrog

### FlyFrog Server Configuration for OIDC

To use OIDC authentication, your FlyFrog server must be configured with:

1. An OIDC provider that accepts GitHub Actions tokens
2. A token exchange endpoint at `/api/v1/oidc/token`
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

## How It Works

This action:
1. Uses the bundled FlyFrog CLI binary
2. Authenticates with your FlyFrog registry using OIDC
3. Runs the `flyfrog setup` command
4. Configures all package managers (or ignores specified ones)

## Building and Publishing

### Development Setup

To work on this action locally, follow these steps:

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the action: `npm run build` 
4. Test: `npm test`

### Publishing

1. Update version in package.json
2. Create a new release tag following semantic versioning
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```
3. Create a new GitHub release with the same tag

## License

This GitHub Action is licensed under the [MIT License](LICENSE).
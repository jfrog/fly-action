<div align="center">

# Fly Action

[![Scanned by Frogbot](https://raw.githubusercontent.com/jfrog/frogbot/refs/heads/master/images/frogbot-badge.svg)](https://docs.jfrog-applications.jfrog.io/jfrog-applications/frogbot)
[![docs](https://img.shields.io/badge/Docs-%F0%9F%93%96-blue)](https://docs.fly.jfrog.com)

</div>

This GitHub Action downloads the Fly CLI and configures package managers to use Fly as a registry for dependencies.

For more information about JFrog Fly, see the [official documentation](https://docs.fly.jfrog.com).

## Features

- ✅ Zero-configuration — tenant resolved automatically from GitHub OIDC token
- ✅ Supports all package managers available in Fly CLI
- ✅ Configures all detected package managers with a single command
- ✅ Upload and download generic artifacts via sub-actions (`[LATEST]` resolves on both authenticated and public paths — fly-service resolves it server-side via AQL on the auth path, 302 redirect on the public path)
- ✅ Distribute generic artifacts publicly via sub-action — share with anyone, no Fly account required
- ✅ Publish Go modules to Fly Go registry
- ✅ OIDC authentication only
- ✅ Allows ignoring specific package managers
- ✅ Automatic CI session end notification to the Fly server
- ✅ Retry mechanism with exponential backoff for CI notifications
- ✅ Exports tenant registry hostname as `FLY_REGISTRY_SUBDOMAIN` environment variable for subsequent steps
- ✅ Job summary with collected artifacts and transfer results

## Quick Start

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
      
      # Setup Fly registry — tenant is resolved automatically from OIDC
      - name: Setup Fly Registry
        uses: jfrog/fly-action@v1

      # FLY_REGISTRY_SUBDOMAIN is now available for Docker, Helm, or any registry operation
      - name: Build and push Docker image
        run: |
          docker build -t ${{ env.FLY_REGISTRY_SUBDOMAIN }}/docker/my-app:${{ github.sha }} .
          docker push ${{ env.FLY_REGISTRY_SUBDOMAIN }}/docker/my-app:${{ github.sha }}
```

## Generic Artifact Sub-Actions

Transfer and publish generic artifacts (binaries, archives, build outputs) using dedicated sub-actions: `upload`, `download`, and `distribute`.

### Upload

```yaml
- name: Upload build artifacts
  uses: jfrog/fly-action/upload@v1
  with:
    name: my-app
    version: '1.0.0'
    files: |
      dist/app.zip
      dist/app.tar.gz
      dist/**
    exclude: |
      *.log
```

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `name` | Package name | Yes | |
| `version` | Package version | Yes | |
| `files` | Files to upload — one per line, supports glob patterns | Yes | |
| `exclude` | Glob patterns to exclude — one per line | No | |
| `if-no-files-found` | Behavior when the `files` glob matches nothing after applying excludes. One of `error` (fail the step), `warn` (log a warning, continue), `ignore` (silent no-op). | No | `error` |

Glob patterns are expanded by the Fly CLI and support recursive matches such as `dist/**`.
Patterns like `dist/**` upload regular files under `dist` recursively.
Directories and symlinks are not uploaded, and symlinked directories are not traversed.
Files are uploaded flat using their basename, so `dist/linux/app.tar.gz` is stored as `app.tar.gz`.

#### Zero-match glob handling

By default, `files` patterns that match nothing fail the step (`error`). For optional artifacts — for example, a build that may or may not produce a debug bundle — set `if-no-files-found` to `warn` (log + continue) or `ignore` (silent no-op):

```yaml
- name: Upload optional debug bundle
  uses: jfrog/fly-action/upload@v1
  with:
    name: my-app
    version: '1.0.0'
    files: |
      dist/debug-*.zip
    if-no-files-found: warn
```

The action validates the value before invoking the Fly CLI. Anything other than `error` / `warn` / `ignore` (case-sensitive) fails the step with an explicit message.

### Download

```yaml
- name: Download a specific version
  uses: jfrog/fly-action/download@v1
  with:
    name: my-app
    version: '1.0.0'
    files: |
      app.zip
    output-dir: ./downloads

- name: Download the latest version (omit version)
  uses: jfrog/fly-action/download@v1
  with:
    name: my-app
    files: |
      app.zip
    output-dir: ./downloads
```

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `name` | Package name | Yes | |
| `version` | Package version. Omit to fetch the latest. | No | `[LATEST]` |
| `files` | Remote filenames to download — one per line | Yes | |
| `output-dir` | Directory to save downloaded files | No | `.` |
| `exclude` | Glob patterns to exclude — one per line | No | |

#### `[LATEST]` resolution

`[LATEST]` is the case-insensitive sentinel for "the most recently published version" (`[LATEST]`, `[latest]`, `[Latest]` all accepted). Where it resolves depends on the path:

| Path | `[LATEST]` resolved? | How |
|---|---|---|
| **Public URL** — `https://{tenant}.jfrog.io/public/generic/{name}/[LATEST]/{file}` (after a `distribute` step) | Yes (today) | `fly-service` returns `302 Found` + `Location: …/{concrete}/{file}` + `Cache-Control: no-store`. The redirect is never CDN-cached, so changes to "latest" are visible immediately; the concrete URL it redirects to is independently cacheable as immutable artifact data. |
| **Authenticated** — `download` sub-action (this is what the action invokes via the Fly CLI) | Yes | fly-service resolves `[LATEST]` server-side via AQL (most recently created version wins) and proxies the file inline — no redirect is issued. The job summary shows the literal `[LATEST]` token rather than the concrete version (display-only limitation; download correctness is unaffected). |

The action defaults `version` to `[LATEST]` for `download` so workflows that omit the version automatically get the latest build.

Use `[LATEST]` for "give me whatever the most recent build is" workflows (consumers in another repo). Pin a concrete version when you need reproducibility (debugging an old release, regression testing).

`[LATEST]` is **download-only**. The Fly server rejects it with `400 Bad Request` on `upload` (PUT/POST) and `distribute` so a literal `[LATEST]`-named folder can never poison future resolution.

### Distribute

Make a generic artifact version publicly downloadable — anyone with the link can grab it without a Fly account. Idempotent: calling again returns the same public URL.

```yaml
- name: Distribute the artifact
  uses: jfrog/fly-action/distribute@v1
  with:
    name: my-app
    version: '1.0.0'
```

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `name` | Package name | Yes | |
| `version` | Package version to make public (concrete; `[LATEST]` not supported here) | Yes | |
| `type` | Artifact type. Currently only `generic` is supported. | No | `generic` |

After distribute succeeds, consumers can fetch the file anonymously:

```bash
# Specific version
curl -O https://{tenant}.jfrog.io/public/generic/my-app/1.0.0/app.zip

# Latest version (server 302-redirects to the newest distributed version)
curl -LO https://{tenant}.jfrog.io/public/generic/my-app/[LATEST]/app.zip
```

The public URL pattern is `https://{tenant}.jfrog.io/public/generic/{name}/{version}/{file}`. On the public path `[LATEST]` is resolved server-side via `302` + `Cache-Control: no-store`, so consumers always see the latest published version (CDN never serves a stale resolution). The authenticated `download` sub-action does not yet resolve `[LATEST]` — see [`[LATEST]` resolution](#latest-resolution) above.

The `results` output is a JSON array with one entry: `{package_name, package_version, package_type, public_url, download_url, download_count}`. Multiple distribute steps in one job accumulate in the job summary's _Distributed Artifacts_ table.

### Go Publish

Publish Go modules to the Fly Go registry.

```yaml
- name: Publish Go module
  uses: jfrog/fly-action/go-publish@v1
  with:
    path: ./libs/mylib   # optional — defaults to repository root
    version: v1.2.3      # optional — auto-detected from git tags if omitted
```

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `path` | Path to the module directory containing `go.mod` | No | `.` |
| `version` | Module version to publish | No | Auto-detected from git tags |

> **Note**: Consumers of modules published to Fly need to configure Go to skip the public checksum database, since privately published modules are not registered on `sum.golang.org`:
>
> ```bash
> go env -w GONOSUMDB=example.com/myorg/* GONOSUMCHECK=example.com/myorg/*
> ```
>
> Replace `example.com/myorg` with your module path prefix (typically the first two segments of the module path).

All three generic sub-actions (`upload`, `download`, `distribute`) output a `results` JSON array — per-file status for upload/download, and a single distributed-artifact entry for distribute:

```yaml
- name: Upload
  id: upload
  uses: jfrog/fly-action/upload@v1
  with:
    name: my-app
    version: '1.0.0'
    files: dist/app.zip

- name: Check results
  run: echo '${{ steps.upload.outputs.results }}'
```

## OIDC Authentication (Required)

This action requires OIDC authentication. The OIDC token is used to track uploads and downloads on the Fly server. You must set `permissions: id-token: write` in your workflow file.

```yaml
permissions:
  contents: read
  id-token: write # Required for OIDC authentication
```

When using OIDC authentication:

1. You need to set `permissions: id-token: write` in your workflow file
2. The action will:
   - Request an OIDC token from GitHub Actions
   - Resolve the Fly tenant automatically from the OIDC token's `repository_owner_id` claim
   - Exchange it for a Fly access token
   - Use the resulting token to authenticate with Fly
   - Automatically notify the Fly server when the CI session ends (using GitHub Actions post-job mechanism)

> **Note**: The CI end notification runs automatically as a post-job step. This ensures it executes even if the main action fails, for proper session management on the Fly server. If the CI end notification step itself encounters an error, it will cause the overall workflow to be marked as failed.

## Inputs

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `ignore` | Comma-separated list of package managers to ignore | No | None |

## Environment Variables

After the action runs, the following environment variables are available in all subsequent steps:

| Variable | Description |
| --- | --- |
| `FLY_REGISTRY_SUBDOMAIN` | Resolved tenant registry hostname (e.g., `acmecorp.jfrog.io`). Use for Docker image tags, Helm OCI refs, etc. |
| `FLY_URL` | Full Fly tenant URL (e.g., `https://acmecorp.jfrog.io`). Used by the fly CLI and sub-actions. |
| `FLY_ACCESS_TOKEN` | Short-lived OIDC-derived access token. Used by the fly CLI and sub-actions. Masked in logs via `core.setSecret`. |

```yaml
- name: Push Docker image
  run: docker push ${{ env.FLY_REGISTRY_SUBDOMAIN }}/docker/my-app:latest

- name: Push Helm chart
  run: helm push mychart-1.0.0.tgz oci://${{ env.FLY_REGISTRY_SUBDOMAIN }}/helmoci

- name: Use fly CLI directly
  run: fly upload --name my-pkg --version 1.0.0 ./artifact.zip
```

### Trust Model

`FLY_ACCESS_TOKEN` is exported to `GITHUB_ENV` so that sub-actions and `run:` steps can use the fly CLI. This means **any subsequent step in the job** (including third-party actions) can read the token via `process.env`. The token is:

- **Short-lived** — scoped to the CI session, expires when the job ends
- **Masked in logs** — registered via `core.setSecret` so it won't appear in action output
- **OIDC-scoped** — derived from the repository's OIDC claims, limited to the tenant

If you use third-party actions after `jfrog/fly-action`, ensure you trust them with this access level.

## GitHub Enterprise Server (GHES)

On GitHub Enterprise Server, the default `fly.jfrog.ai` endpoint cannot resolve tenants because GHES installations live in a separate Fly environment.

Set the `CUSTOM_FLY_URL` organization-level variable to your Fly environment URL:

```yaml
env:
  CUSTOM_FLY_URL: https://fly.your-instance.jfrog.info

jobs:
  build:
    runs-on: self-hosted
    steps:
      - uses: jfrog/fly-action@v1
```

The action enforces HTTPS on all custom URLs to prevent OIDC token exfiltration.

## Supported Package Managers

The action supports all package managers that the Fly CLI supports:

- **npm, pnpm, yarn** – Node.js package managers (npm registry)
- **pip, pipenv, poetry, twine, uv** – Python package managers (PyPI repository)
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

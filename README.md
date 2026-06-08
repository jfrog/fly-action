<div align="center">

<img src="images/fly.jpg" alt="JFrog Fly" width="480" />

# JFrog Fly — GitHub Action

**Seamlessly integrate JFrog Fly, the AI-native registry, into your build and release pipelines.**

[![Scanned by Frogbot](https://raw.githubusercontent.com/jfrog/frogbot/refs/heads/master/images/frogbot-badge.svg)](https://docs.jfrog-applications.jfrog.io/jfrog-applications/frogbot)
[![docs](https://img.shields.io/badge/Docs-%F0%9F%93%96-blue)](https://docs.fly.jfrog.com)

</div>

This action authenticates with JFrog Fly and configures your package managers — npm, pip, Maven, Go, Docker, and more — so they resolve and publish through Fly automatically. No tokens, no secrets, no manual setup.

```yaml
- uses: jfrog/fly-action@v1
```

That's it. Every package manager on the runner is now wired to Fly.

## What is JFrog Fly?

JFrog Fly is a release management platform for software teams. Every build your CI produces becomes a tracked release — linked to its commits, PRs, and artifacts, searchable by content from your IDE and available for your coding agents.

> **Not affiliated with Fly.io** (the application deployment platform).

**From your coding agent you can:**

- Find any release by what it contains: *"Find the release that fixed the login bug"*
- Configure CI end-to-end: *"Start working with Fly"*
- Deploy to Kubernetes: *"Deploy the latest staging release to production"*
- Track what's running: *"Is the login fix live in production?"*

Works with Cursor, Claude Code, VS Code (Copilot), and OpenCode.

## Install JFrog Fly

Fly Desktop installs in seconds and automatically configures your coding agent and package managers.

**macOS / Linux**

```bash
curl -fsSL https://fly.jfrog.ai/download/desktop | bash
```

**Windows**

```powershell
powershell -c "irm https://fly.jfrog.ai/download/desktop | iex"
```

The app opens and walks you through sign-up. Once installed, open your IDE and ask:

```
Start working with Fly
```

Your agent connects your GitHub repo, configures CI authentication, and opens a verified PR — no manual steps.

→ [Full getting-started guide](https://docs.fly.jfrog.com/getting-started)

## Why use it

- **Zero-configuration authentication** — no tokens or secrets to manage; auth is derived from your workflow's GitHub OIDC identity.
- **Every package manager, one step** — all detected package managers are configured automatically.
- **Artifact transfer built in** — upload, download, and publicly distribute artifacts via dedicated sub-actions.
- **Public sharing** — distribute generic artifacts or Docker images so anyone can pull them, no Fly account required.
- **Go module publishing** — publish modules straight to the Fly Go registry.
- **Visible results** — a job summary lists collected artifacts and transfer results.

## Quick Start

```yaml
name: Build with Fly
on: [push]

permissions:
  contents: read
  id-token: write   # required — Fly authenticates via GitHub OIDC

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Authenticate and configure all package managers
      - uses: jfrog/fly-action@v1

      # FLY_REGISTRY_SUBDOMAIN is now ready for Docker, Helm, or any registry op
      - name: Build and push Docker image
        run: |
          docker build -t ${{ env.FLY_REGISTRY_SUBDOMAIN }}/docker/my-app:${{ github.sha }} .
          docker push ${{ env.FLY_REGISTRY_SUBDOMAIN }}/docker/my-app:${{ github.sha }}
```

> **`id-token: write` is required.** Fly uses your workflow's GitHub OIDC identity to authenticate — there are no secrets to configure. See [Authentication](#authentication) for details.

## Common Use Cases

After the action runs, three environment variables are available to every later step — most commonly `FLY_REGISTRY_SUBDOMAIN` for tagging images and charts. See [Environment Variables](#environment-variables) for the full list.

**Push a Docker image**

```yaml
- run: docker push ${{ env.FLY_REGISTRY_SUBDOMAIN }}/docker/my-app:latest
```

**Push a Helm chart (OCI)**

```yaml
- run: helm push mychart-1.0.0.tgz oci://${{ env.FLY_REGISTRY_SUBDOMAIN }}/helmoci
```

**Skip specific package managers**

```yaml
- uses: jfrog/fly-action@v1
  with:
    ignore: docker,pip,uv   # configure everything except these
```

## Artifact Sub-Actions

Transfer and publish generic artifacts (binaries, archives, build outputs) using dedicated sub-actions. Each requires the main `jfrog/fly-action@v1` step to have run earlier in the job.

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
| `if-no-files-found` | What to do when `files` matches nothing: `error` (fail), `warn` (log and continue), or `ignore` (silent no-op) | No | `error` |

**File handling:** glob patterns like `dist/**` match regular files recursively. Directories and symlinks are skipped. Files are stored flat by basename, so `dist/linux/app.tar.gz` is uploaded as `app.tar.gz`.

For optional artifacts that may not exist (e.g. a debug bundle), set `if-no-files-found: warn` or `ignore` so a zero-match doesn't fail the build.

### Download

```yaml
# Download a specific version
- uses: jfrog/fly-action/download@v1
  with:
    name: my-app
    version: '1.0.0'
    files: |
      app.zip
    output-dir: ./downloads

# Download the latest version — omit version
- uses: jfrog/fly-action/download@v1
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

**Latest version:** omit `version` (or pass the case-insensitive `[LATEST]`) to always fetch the most recently published version. Pin a concrete version when you need reproducibility, such as debugging an old release. `[LATEST]` works for downloads only — it cannot be used when uploading or distributing.

### Distribute

Make an artifact version publicly downloadable — anyone with the link can grab it without a Fly account. The call is idempotent: running it again returns the same public URL. Supported types: **generic** and **docker**.

**Generic**

```yaml
- uses: jfrog/fly-action/distribute@v1
  with:
    name: my-app
    version: '1.0.0'
```

Consumers then fetch the file anonymously:

```bash
# Specific version
curl -O https://{tenant}.jfrog.io/public/generic/my-app/1.0.0/app.zip

# Latest version
curl -LO https://{tenant}.jfrog.io/public/generic/my-app/[LATEST]/app.zip
```

**Docker**

The image must already be pushed to your Fly registry (`docker push {tenant}.jfrog.io/docker/...` after the main action configured Docker). Distribute then makes it publicly pullable.

```yaml
- uses: jfrog/fly-action/distribute@v1
  with:
    name: myorg/my-image      # image name, without registry host or prefix
    version: '1.0.0'          # image tag
    type: docker
```

Consumers then pull anonymously:

```bash
# Specific tag
docker pull {tenant}.jfrog.io/docker-public/myorg/my-image:1.0.0

# Latest tag
docker pull {tenant}.jfrog.io/docker-public/myorg/my-image:[LATEST]
```

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `name` | Package name. For Docker, the image name without the registry host or `docker-public/` prefix; nested names like `myorg/myimg` are supported. | Yes | |
| `version` | Version to make public (for Docker, the image tag). Must be a concrete version — `[LATEST]` is not accepted. | Yes | |
| `type` | Artifact type: `generic` or `docker`. | No | `generic` |

**Latest on public URLs:** consumers can use `[LATEST]` on both the generic and Docker public URLs to always resolve the newest distributed version. Updates are reflected immediately.

**Output:** the `results` output is a JSON array with one entry: `{package_name, package_version, package_type, public_url, download_url, download_count, files?}`. Docker distributions also print a ready-to-paste `docker pull …` command in the step logs. Multiple distribute steps accumulate in the job summary's _Distributed Artifacts_ table.

### Go Publish

Publish Go modules to the Fly Go registry.

```yaml
- uses: jfrog/fly-action/go-publish@v1
  with:
    path: ./libs/mylib   # optional — defaults to the repository root
    version: v1.2.3      # optional — auto-detected from git tags if omitted
```

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `path` | Path to the module directory containing `go.mod` | No | `.` |
| `version` | Module version to publish | No | Auto-detected from git tags |

> **Consuming privately published modules:** because they aren't registered on `sum.golang.org`, consumers must tell Go to skip the public checksum database:
>
> ```bash
> go env -w GONOSUMDB=example.com/myorg/* GONOSUMCHECK=example.com/myorg/*
> ```
>
> Replace `example.com/myorg` with your module path prefix (typically the first two segments of the module path).

### Reading sub-action results

The `upload`, `download`, and `distribute` sub-actions all expose a `results` JSON output — per-file status for upload/download, and a single artifact entry for distribute:

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

## Configuration Reference

### Inputs

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `ignore` | Comma-separated list of package managers to skip. By default, all detected package managers are configured. | No | None |

### Environment Variables

After the action runs, these variables are available in all subsequent steps:

| Variable | Description |
| --- | --- |
| `FLY_REGISTRY_SUBDOMAIN` | Your Fly registry hostname (e.g. `acmecorp.jfrog.io`). Use it for Docker image tags, Helm OCI refs, etc. |
| `FLY_URL` | Full Fly URL (e.g. `https://acmecorp.jfrog.io`). Used by the Fly CLI and sub-actions. |
| `FLY_ACCESS_TOKEN` | Short-lived access token derived from OIDC. Used by the Fly CLI and sub-actions. Masked in logs. |

## Authentication

This action authenticates using **GitHub OIDC** — there are no secrets to create or rotate. You only need to grant the workflow permission to request an OIDC token:

```yaml
permissions:
  contents: read
  id-token: write   # required for OIDC authentication
```

With that in place, the action requests an OIDC token, exchanges it for a short-lived Fly access token, and uses it to configure your package managers. It also notifies Fly automatically when the CI session ends, via a post-job step.

> **Note:** the end-of-session notification runs as a post-job step so it executes even if the main action fails. If that notification step itself errors, the workflow is marked as failed.

### Trust model

`FLY_ACCESS_TOKEN` is exported to the job environment so sub-actions and `run:` steps can use the Fly CLI. This means **any later step in the same job — including third-party actions — can read it.** The token is:

- **Short-lived** — scoped to the CI session and expires when the job ends
- **Masked in logs** — registered as a secret so it won't appear in output
- **OIDC-scoped** — derived from your repository's OIDC identity and limited to your tenant

If you run third-party actions after `jfrog/fly-action`, make sure you trust them with this access.

## Supported Package Managers

| Ecosystem | Tools |
| --- | --- |
| Node.js | npm, pnpm, yarn |
| Python | pip, pipenv, poetry, twine, uv |
| .NET | nuget, dotnet |
| Containers | docker, podman |
| Kubernetes | helm |
| Go | go |
| Java | gradle, maven |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and publishing.

## License

Licensed under [Apache-2.0](LICENSE).

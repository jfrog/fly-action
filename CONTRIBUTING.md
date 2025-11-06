# Contributing to Fly Action

Thank you for your interest in contributing to Fly Action! This guide will help you get started with development, testing, and publishing.

## Development Setup

To develop and test locally:

1. Clone the repository.
2. Install dependencies: `npm install` (this also runs Prettier via the `postinstall` hook).
3. Build: `npm run build` (this formats, type-checks TypeScript with `tsc`, and bundles the TypeScript source files into JavaScript for the action using `ncc`).
4. Run tests: `npm test`.

> A Husky pre-commit hook is configured—any `git commit` will trigger `npm run build` to ensure your code is formatted, compiled, and bundled before committing.

## Build Process

The action is built using `npm run build`. This command formats the code with Prettier, performs type checking using TypeScript (`tsc`), and then compiles and bundles `src/index.ts` and `src/post.ts` into single executable JavaScript files: `lib/index.js` and `lib/post.js`. These `lib/` files are what the GitHub Action executes.

A Husky pre-commit hook is configured to run `npm run build` automatically on each commit, ensuring that code is formatted, type-checked, and bundled before being committed.

## Testing

### Unit Tests

Run the unit tests with:

```bash
npm test
```

### Integration Tests

Integration tests run automatically on pushes to the main branch, but require a valid Fly test server to be configured. The integration test will only run if the `FLY_TEST_URL` repository variable is set.

To configure integration testing:

1. Set up a Fly server that supports the required API endpoints
2. Set the `FLY_TEST_URL` repository variable in your GitHub repository settings
3. The integration test will automatically run on the next push

## Publishing a New Version

- Ensure tests pass and build is up to date:

  ```bash
  npm test && npm run build
  ```

- Push changes to the default branch (e.g., `main`):

  ```bash
  git push origin main
  ```

- Draft a release in the GitHub UI:
  1. Go to the "Releases" page of your repository.
  2. Click **Draft a new release**.
  3. Set the tag name to `vX.Y.Z` (e.g., `v1.2.3`).
  4. Publish the release.

Once the release is published, the GitHub Actions workflow will:

1. Extract the version from the tag (`vX.Y.Z`).
2. Bump `package.json` and `package-lock.json` to `X.Y.Z`.
3. Commit and push the updated lockfile.
4. Update and force-push the `vX.Y` and `vX` tags.
5. Push all changes back to the repository.


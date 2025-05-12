# Contributing to FlyFrog Action

Thank you for your interest in improving this GitHub Action! Please follow these steps to ensure a smooth contribution process.

## 📥 Getting Started

1. Fork the repository and clone your fork:
   ```bash
   git clone git@github.com:<your-username>/flyfrog-action.git
   cd flyfrog-action
   ```
2. Install dependencies (this also runs Prettier):
   ```bash
   npm install
   ```
3. Verify formatting, build, and tests pass locally:
   ```bash
   npm run format
   npm run lint
   npm test
   npm run build
   ```

## 💻 Making Changes

- Work in the `src/` directory and keep your code concise and well-documented.
- Run `npm run format` to auto-format code before committing.
- Commit only source (`src/`) and the generated bundle (`lib/index.js`). Do not commit `dist/`, `node_modules/`, or any other transient files.
- Follow conventional commit messages (e.g., `feat:`, `fix:`, `chore:`).

## 🤝 Pull Requests

1. Push your feature branch to GitHub.
2. Open a pull request against `main`.
3. Ensure GitHub Actions CI passes (lint, tests, build).
4. Address any review feedback.

## 🛠️ CI & Hooks

- A Husky pre-commit hook automatically runs the build (format → compile → bundle).
- The CI workflow (`.github/workflows/test.yml`) lints, tests, and builds on every push/PR to `main`.

## 🚀 Release Process

Releases are handled via GitHub Actions when you publish a new tag. Major and minor tags are updated automatically by the `release.yml` workflow.

---

By contributing, you agree that your contributions will be licensed under the project's MIT License.

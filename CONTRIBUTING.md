# Contributing to Inboxfm Connect

Contributions to documentation, tests, integration actions, and the headless platform are welcome! Inboxfm Connect is an independent, community-driven fork building a headless AI integration platform. Please read [LICENSING.md](LICENSING.md) and adhere to the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

---

## 🛠️ Prerequisites

Before getting started, ensure your local development environment meets the following requirements:

- **Node.js**: `v18.x`, `v22.x`, or `v24.x` (enforced by `tools/setup-dev.js`; Node 20 is strictly not supported by the build toolchain).
- **Bun**: `1.3.3` (required package manager pinned in `package.json`; auto-installed globally by `tools/setup-dev.js` if not found).
- **npm**: `>=9.0.0`
- **Database**: Zero-setup embedded PostgreSQL powered by **PGlite** (`AP_DB_TYPE=PGLITE` in `.env.dev`). External PostgreSQL `>=14` can be used via `AP_DB_TYPE=POSTGRES`. SQLite3 is deprecated and automatically migrated to PGLite.
- **Queue & Cache**: In-memory Redis queue by default (`AP_QUEUE_MODE=MEMORY`, `AP_REDIS_TYPE=MEMORY`). External Redis `>=6.0` is supported.
- **Operating System**: Linux, macOS, or WSL2 on Windows is strongly recommended for native module builds and shell-based scripts. Native modules may require Python and a C/C++ toolchain.

---

## 🚀 Local Development Setup

### 1. Fork and Clone

```bash
git clone https://github.com/YOUR_USERNAME/inboxfm-connect.git
cd inboxfm-connect
git remote add upstream https://github.com/Mihir-Rabari/inboxfm-connect.git
git fetch upstream
git switch -c fix/issue-123-short-description upstream/dev
```

### 2. First-Time Setup & Start

Run `npm start` to run the onboarding script `tools/setup-dev.js`, which verifies Node.js compatibility, ensures Bun is available, installs dependencies via `bun install --frozen-lockfile`, pre-builds development integrations specified in `AP_DEV_PIECES`, and launches the backend API and execution engine:

```bash
npm start
```

### 3. Start the Web Dashboard

In a separate terminal, start the React-based frontend dashboard:

```bash
bun x turbo run serve --filter=@inboxfm-connect/web
```

Open [http://localhost:4200](http://localhost:4200) in your browser. The backend REST API listens on port 3000 ([http://localhost:3000](http://localhost:3000)).

### 4. Subsequent Development Runs

Once dependencies and dev pieces are initialized, you can start the backend and engine directly without re-running full setup:

```bash
npm run dev
```

### 5. Environment Configuration

Configuration is controlled via `.env.dev`. Key settings:
- `AP_DEV_PIECES="google-sheets,store"`: Comma-separated piece folders to pre-build for faster local startup.
- `AP_DB_TYPE=PGLITE`: Default zero-setup embedded database stored at `./dev/config`.
- `AP_QUEUE_MODE=MEMORY` and `AP_REDIS_TYPE=MEMORY`: In-memory job execution for rapid local iteration.

---

## 🧩 Piece Development Quickstart

Integrations in Inboxfm Connect live under `packages/integrations/{community,core}` and are built using `@inboxfm-connect/pieces-framework` and `@inboxfm-connect/pieces-common`.

### Scaffolding a New Piece

Use the CLI generator to scaffold a new piece:

```bash
npm run create-piece
```

You can also scaffold individual actions or triggers within an existing piece:

```bash
npm run create-action
npm run create-trigger
```

### Building & Testing Pieces

To build a specific piece:

```bash
npm run build-piece <piece-name>
```

To run unit tests for an integration piece, navigate to its folder under `packages/integrations/community/<piece-name>` or `packages/integrations/core/<piece-name>` and run:

```bash
npx vitest run
```

---

## 📐 Code & Security Guidelines

- **Tenant Isolation**: Every database query and business operation must strictly scope data access to `projectId` or `platformId`.
- **SSRF Guard**: All outbound server-side HTTP requests must use `safeHttp.axios` or `safeHttp.createAxios()` to prevent SSRF vulnerabilities.
- **Package Boundaries**: Keep integration pieces and the engine runtime decoupled from `@inboxfm-connect/shared`. Pieces must only import from `@inboxfm-connect/pieces-framework` and `@inboxfm-connect/pieces-common`.
- **Database Migrations**: Register every new TypeORM entity in `getEntities()` and provide matching TypeORM migration scripts. Consult [docs/handbook/engineering/playbooks/database-migration.mdx](docs/handbook/engineering/playbooks/database-migration.mdx).
- **Enterprise Boundary**: Never introduce new imports from `packages/ee/` into MIT-licensed packages (`packages/core`, `packages/integrations`, `packages/runtime`, `packages/server/engine`). See [LICENSING.md](LICENSING.md).
- **Credentials & Secrets**: Never commit real credentials, sensitive API keys, or private tokens.

---

## 🧪 Verification & Pre-PR Checks

This monorepo uses **Turborepo**. Before opening a pull request, run the following validation suite locally to guarantee a clean CI run:

```bash
# 1. Linting & formatting check
npm run lint-dev

# 2. Unit test suites
npm run test-unit

# 3. API integration tests (PGlite & memory Redis)
npm run test-api

# 4. Database migration integrity
npm run check-migrations

# 5. Licensing boundary audit
npm run check-licenses
```

To run linting and typechecking specifically on the web dashboard:

```bash
bun x turbo run lint typecheck --filter=@inboxfm-connect/web
```

---

## 📝 Commit & PR Conventions

- **Branch Policy**: Always branch from `upstream/dev` and open pull requests targeting the **`dev`** branch. `main` is reserved for maintainer-reviewed promotion releases.
- **Commit Message Convention**: Commit messages are strictly validated by Commitlint and must follow the Conventional Commits specification under 100 characters:
  ```text
  <type>(<scope>): <subject> (#<issue>)
  ```
  Allowed types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `perf`, `ci`.
  Example:
  ```text
  fix(infra): update setup-dev and crowdin to packages/integrations path (#179)
  ```
- **PR Description**: Include a clear summary of changes, problem addressed, resolution details, and reference the associated issue (`Resolves #123`).

---

## 🔒 Security Reporting

Report security vulnerabilities privately as detailed in [SECURITY.md](SECURITY.md). Do not file public GitHub issues for security vulnerabilities.

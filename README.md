# Inboxfm Connect

[![CI](https://github.com/Mihir-Rabari/inboxfm-connect/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Mihir-Rabari/inboxfm-connect/actions/workflows/ci.yml)
[![Contribute to dev](https://img.shields.io/badge/PRs-target%20dev-blue)](CONTRIBUTING.md)

A headless integration platform for AI applications: connect user accounts, discover tools, and execute integration actions through REST, MCP, or a TypeScript SDK.

Inboxfm Connect is an independent fork of [Activepieces](https://github.com/activepieces/activepieces). It builds on the upstream integration ecosystem and replaces the visual flow builder with a headless application. See [upstream credits](UPSTREAM_CREDITS.md). This fork is not affiliated with or endorsed by Activepieces.

**Development preview:** use it for local experiments and hackathon projects. Production hardening and removal of inherited Enterprise dependencies are still tracked work. The repository contains both MIT and Enterprise-licensed material; see [licensing](LICENSING.md) before deploying or redistributing it.

## What you can build

- Embedded connection flows for end users and project-scoped API keys.
- Tool discovery and execution across the inherited integration catalog.
- MCP servers that expose integrations and tables to compatible AI clients.
- Applications that use structured tables, scheduled tasks, and trigger bindings.
- A dashboard for integrations, connections, MCP servers, and API keys.

Third-party integrations may require an account, credentials, or a paid service. Use sandbox accounts and test data for demos.

## Start locally

Use **Node.js 24** and **Bun 1.3.3** (pinned in `package.json`). Linux, macOS, or WSL2 is recommended for the native dependencies and shell-based test commands. Native dependency builds may require Python and a C/C++ toolchain.

```bash
git clone https://github.com/Mihir-Rabari/inboxfm-connect.git
cd inboxfm-connect
git switch dev
npm start
```

`npm start` installs dependencies, builds the configured development integrations, and starts the backend and engine. In another terminal, start the web application:

```bash
bun x turbo run serve --filter=@inboxfm-connect/web
```

Open [localhost:4200](http://localhost:4200). The API listens on port 3000. See [the hackathon guide](docs/HACKATHON.md) for environment settings, credentials, sample projects, and troubleshooting. Subsequent backend starts use `npm run dev`.

## SDK and API

The SDK source and runnable examples live in [packages/connect-sdk](packages/connect-sdk). Its [README](packages/connect-sdk/README.md) describes authentication, connection sessions, tool discovery, and action execution; the [SDK overview](docs/connect-sdk/overview.mdx) and [reference](docs/connect-sdk/reference.mdx) cover the public contract.

```ts
import { InboxFM } from '@inboxfm-connect/sdk'

const inboxfm = new InboxFM({
  baseUrl: 'http://localhost:3000/api',
  projectId: process.env.INBOXFM_PROJECT_ID,
  apiKey: process.env.INBOXFM_API_KEY,
})

const tools = await inboxfm.listTools({
  integration: '@inboxfm-connect/piece-text-helper',
})
```

Keep API keys on the server. The examples use development credentials; never commit real credentials or expose them in a browser bundle.

## Repository map

| Area | Location |
| --- | --- |
| REST API, tenant security, persistence | [packages/server/api](packages/server/api) |
| Headless runtime and engine | [packages/runtime](packages/runtime), [packages/server/engine](packages/server/engine) |
| Sandbox and server utilities | [packages/server/sandbox](packages/server/sandbox), [packages/server/utils](packages/server/utils) |
| Thin core libraries and application schemas | [packages/core](packages/core) |
| Integration framework and catalog | [packages/integrations](packages/integrations) |
| Dashboard | [packages/web](packages/web) |
| TypeScript client | [packages/connect-sdk](packages/connect-sdk) |
| Scheduling | [packages/scheduler](packages/scheduler) |
| Inherited restricted code | `packages/ee/`, `packages/server/api/src/app/ee/` |

Read [ARCHITECTURE.md](ARCHITECTURE.md) for execution flows, package boundaries, storage, and where to make changes.

## Contribute

Branch from `dev` and open your PR against **`dev`**. `main` receives reviewed promotions from `dev`. Check existing issues and PRs before starting, keep each change focused, and include its issue number.

Start with [CONTRIBUTING.md](CONTRIBUTING.md), [the hackathon guide](docs/HACKATHON.md), and [open issues](https://github.com/Mihir-Rabari/inboxfm-connect/issues). Follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md). Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

## Checks

```bash
npm run lint-dev
npm run test-unit
npm run test-api
npm run check-migrations
npm run check-licenses
```

CI runs on every PR, pushes to `dev` and `main`, and merge queues. It checks workflow syntax, attribution and Enterprise boundaries, lint, types, builds, SDK packaging, unit/web tests, edition integration tests, PostgreSQL behavior, migrations, and affected integrations. See [docs/CI.md](docs/CI.md) for the exact jobs and local commands.

## License and attribution

Keep the original copyright and license notices. Most application code is covered by the [root license](LICENSE), which explicitly excludes the two Enterprise directories and preserves third-party license terms. Those Enterprise directories are governed by [Activepieces' Enterprise license](packages/ee/LICENSE); tests passing or choosing an edition does not grant additional license rights.

See [LICENSING.md](LICENSING.md) for the current limitations and [UPSTREAM_CREDITS.md](UPSTREAM_CREDITS.md) for acknowledgements.

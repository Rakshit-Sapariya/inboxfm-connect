# Contributing to Inboxfm Connect

Contributions to documentation, tests, integration actions, and the headless platform are welcome. Read [LICENSING.md](LICENSING.md) and follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Branches and pull requests

- `dev` is the integration branch. Create your branch from the latest `dev` and target **`dev`** in your PR.
- `main` is the stable branch. Only a maintainer-reviewed PR from this repository's `dev` branch should target `main`.
- Keep Git history and authorship intact. Do not force-push shared branches.
- Address one tracked issue per PR. Check open PRs first to avoid duplicate work.

```bash
git clone https://github.com/YOUR_USERNAME/inboxfm-connect.git
cd inboxfm-connect
git remote add upstream https://github.com/Mihir-Rabari/inboxfm-connect.git
git fetch upstream
git switch -c fix/issue-123-description upstream/dev
```

Push your branch to your own fork, then open a PR to `Mihir-Rabari/inboxfm-connect:dev`. Here, `upstream` means the Inboxfm Connect repository you contribute to; the original Activepieces project is credited separately.

Use a conventional PR title, such as `fix(api): scope connection lookup to its project`, `feat(integrations): add an action`, or `docs: clarify local setup`. PR-title validation runs even when the contribution comes from a fork.

## Choose work and get started

1. Pick an [open issue](https://github.com/Mihir-Rabari/inboxfm-connect/issues) or describe the proposed change in an issue before substantial work. Documentation corrections and small fixes can reference a new, focused issue.
2. Read [ARCHITECTURE.md](ARCHITECTURE.md), root and package `AGENTS.md` files, and the relevant `.agents/features/*.md` documentation. Some feature notes describe removed upstream features; confirm paths against current source.
3. Follow `.claude/rules/` for tenant isolation, entity registration, edition boundaries, core packages, and safe outbound HTTP.
4. Use the setup in [README.md](README.md) or [docs/HACKATHON.md](docs/HACKATHON.md). CI uses Node 24 and Bun 1.3.3.

## Code and security conventions

- Scope data access to the appropriate `projectId` or `platformId`.
- Set endpoint `securityAccess`. Use `POST` for creates/updates and `DELETE` for deletion.
- Register every new TypeORM entity in `getEntities()` and add a matching migration.
- Use proper types, a destructured object for functions with multiple parameters, and immutable data flow. Do not introduce `any`, forced casts, or deprecated APIs.
- Keep integration and engine code independent of the thick `@inboxfm-connect/shared` package.
- Use `safeHttp.axios` or `safeHttp.createAxios()` for server-side outbound HTTP; preserve SSRF protection.
- User-facing validation messages must be translation keys.
- Do not copy or relocate Enterprise-licensed implementation into MIT directories, strip notices, or introduce new Enterprise imports. See [LICENSING.md](LICENSING.md).
- Never commit live credentials, personal data, or production environment files.

## Validate your change

This monorepo uses **Turborepo**, not Nx. Run the required lint command and the suites relevant to your change:

```bash
npm run lint-dev
npm run test-unit
npm run test-api
npm run check-migrations
npm run check-licenses

# A specific frontend or SDK check:
bun x turbo run lint typecheck --filter=@inboxfm-connect/web
npm run pack:verify --workspace=@inboxfm-connect/sdk
```

The API test environment supplies PGlite and memory Redis; the dedicated CI job also tests PostgreSQL with pgvector. Native dependencies and API package scripts are best run on Linux/macOS/WSL2. See [docs/CI.md](docs/CI.md) for direct CI reproduction.

Add meaningful regression tests for behavior changes. Cover the edition and plan paths affected by a change, including CE, EE, Cloud standard/paid/enterprise where relevant. Enterprise tests exercise development/testing permission; they do not authorize production use.

Before changing migrations, read the [Database Migrations Playbook](https://www.inboxfm-connect.com/docs/handbook/engineering/playbooks/database-migration#database-migrations). Do not generate a migration just to silence an infrastructure failure.

## Submit and review

Include the problem, resulting behavior, issue reference, validation performed, and any relevant limitations. Add screenshots for UI changes and a minimal reproduction for bugs.

Every PR must have exactly one primary label: `feature`, `bug`, or `skip-changelog`. Integration changes additionally need `area/third-party-integrations` or `area/core-integrations`. Maintainers can apply labels when fork contributors lack permission.

All PRs receive CI checks, including documentation-only and draft PRs. The `main` CI check summarizes every required suite and fails if a suite fails or is cancelled. Fork PRs run without deployment or publishing secrets; GitHub may require maintainer approval for a first-time contributor's workflow.

Respond to valid review comments, including automated reviews, and explain disagreements with evidence. A maintainer makes the final merge decision. Preserve other contributors' work when resolving conflicts.

## Community and reporting

For a new contributor or hackathon team, [docs/HACKATHON.md](docs/HACKATHON.md) suggests small starting points and a demo checklist.

Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Use issues for ordinary bugs and proposals; please include steps, expected behavior, actual behavior, and the relevant environment.

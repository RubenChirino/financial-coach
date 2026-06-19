# Contributing

Thanks for considering a contribution. This project aims to be a calm, well-crafted tool that people trust with sensitive financial data, so the bar for changes is high — not because we want to gatekeep, but because bugs here can leak PII.

## Ground rules

1. **Privacy first.** Any change that adds outbound network calls, telemetry, or persisted data requires explicit discussion in an issue first.
2. **No secrets, ever.** `.env.local` stays on your machine. Run `pnpm gitleaks` locally before pushing.
3. **Test what you change.** Crypto, redaction, categorization, and bank-sync logic must ship with tests.
4. **i18n lockstep.** Any user-facing string added to `src/messages/es.json` must also go into `en.json`.

## Understanding the codebase

Before your first change, skim **[ARCHITECTURE.md](ARCHITECTURE.md)**. It explains
the two runtime modes, where business logic lives (`src/lib/*`), the
server/client boundary rules (and the serialization pitfalls that have bitten us
in production), and the security model your change has to respect.

## Dev setup

```bash
git clone https://github.com/rubenchirino/financial-coach
cd financial-coach
cp .env.example .env.local                          # fill in APP_SECRET
pnpm install
pnpm db:migrate
pnpm db:seed                                         # optional: synthetic data for local dev
pnpm dev
```

Requirements: Node.js 24 LTS, pnpm 9+. `.nvmrc` pins the Node version if you use nvm or fnm.

Useful scripts: `pnpm test` (Vitest unit/component), `pnpm e2e` (Playwright
end-to-end), `pnpm db:studio` (Drizzle Studio), `pnpm lint:fix` (Biome).

## Branching & commits

- Branch from `main`. Branch names: `feat/short-topic`, `fix/short-topic`, `docs/...`, `chore/...`.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(advisor): stream responses from Ollama`.
- We recommend signing commits (`git commit -S`). GitHub's "Verified" badge is nice.

## Pull requests

Small and focused beats big and sprawling. A good PR:

- Does one thing.
- Updates tests for the changed code.
- Updates docs/i18n if user-visible.
- Passes CI: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm gitleaks`, `pnpm build`.
- Has a description explaining **why**, not just **what**.

The PR template walks you through the checklist.

## Recommended GitHub branch protection

For maintainers of forks or production deployments, we recommend enabling on `main`:

- Require a pull request before merging.
- Require status checks: `ci / test`, `ci / typecheck`, `ci / lint`, `ci / gitleaks`.
- Require signed commits.
- Require linear history.
- Do not allow force pushes.

## Code of Conduct

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Questions?

Open a [discussion](https://github.com/rubenchirino/financial-coach/discussions) or an issue. For security issues, follow [`SECURITY.md`](SECURITY.md).

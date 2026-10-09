# Bayline Growth

A React + Node.js dashboard for a tint, ceramic, PPF and wrap business. It brings operational performance, accounting results and advertising attribution into one role-aware workspace, while keeping their different revenue definitions visible.

This is an independently built implementation of the [original project brief](docs/original-brief.md), not the client's private system. No real client accounts, credentials, messages or financial data were used. Live provider mapping, reconciliation and hosting acceptance remain installation tasks.

## What is implemented

- Responsive performance overview, exact-period revenue targets, service mix and daily completed-job revenue.
- Lead creation cohorts, median speed-to-lead with timestamp coverage, decided-lead close rates, overdue follow-ups and team scorecards.
- Bay utilization with explicit availability coverage; last-click advertising ROAS/CPL; owner-only QuickBooks P&L and net margin.
- Owner, manager and team access enforced on the server. Team views contain only assigned work, with no revenue, advertising or accounting fields.
- GoHighLevel read-only private integration, Hyros campaign reads, QuickBooks OAuth2 and P&L reads, and signed normalized imports for all four sources. TintWiz uses its documented Zapier integration rather than an assumed public REST API.
- Complete-snapshot validation → owner review → atomic acceptance. Conflicting, stale or expired reviews cannot overwrite newer data. Accepted batches and activity remain in history.
- Durable read queue, bounded external requests, encrypted OAuth tokens, conservative refresh recovery, CSRF/origin protection, session revocation and in-app KPI alerts.
- Non-root Docker deployment, PostgreSQL 17, browser/role workflows, SQL recovery checks and CI.

## Run locally

Use Node 24 and a PostgreSQL database owned by a non-superuser application role. Copy `.env.example` to `.env`, configure `DATABASE_URL`, and keep local `APP_ORIGIN=http://localhost:3000`. This app supports one business, one two-decimal currency and one IANA timezone per installation.

```sh
npm ci
npm run build
# Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD in your shell or a private env file.
node --env-file=.env scripts/admin.js
node --env-file=.env backend/server.js
# In a separate process, after schema initialization:
node --env-file=.env backend/worker.js
```

The server initializes the schema transactionally. Run one web instance during schema initialization/upgrades. The worker needs the same database and provider configuration. It only prepares pending reviews; an owner must accept them. No automatic approval, outbound messaging or third-party mutations are performed.

For a fictional, empty development database, set `ALLOW_DEMO=true` and a 12+ character `DEMO_PASSWORD`, then run `node --env-file=.env scripts/demo.js`. Demo accounts are `owner@example.test`, `manager@example.test` and `team@example.test`, all using that supplied password. Demo data uses UTC and is refused in production. Never run it against a client's database.

## Verify

```sh
npm test                         # embedded PostgreSQL locally
npm run build
npx playwright install chromium
npm run test:browser
npm audit --omit=dev --audit-level=high
```

Set `TEST_DATABASE_URL` only to a disposable database: tests and browser verification DROP its public schema. GitHub Actions runs the suite against PostgreSQL 17 using a non-superuser, verifies desktop/mobile workflows, restores a database dump and builds the production image. Browser screenshots are retained as CI artifacts. Contract fixtures verify provider behavior; they do not prove a client's live integration is accepted.

## Handoff

- [Requirements and acceptance](docs/requirements.md)
- [Metrics and import contract](docs/data-contract.md)
- [Provider setup and source documentation](docs/integrations.md)
- [Deployment, account recovery and backup/restore](docs/operations.md)

A push to GitHub delivers source code. It does not create a client deployment or connect accounts. Use the acceptance checklist before reporting a live rollout complete.

# Deployment and recovery

## Small-host Docker deployment

1. Provision a host, DNS name and firewall allowing 80/443 only. Do not expose PostgreSQL or the app port publicly.
2. Copy `.env.example` to `.env`, use strong distinct database admin/application passwords, and set `APP_ORIGIN=https://your-host`, `DOMAIN=your-host`, `DATABASE_URL=postgresql://bayline:URL_ENCODED_APPLICATION_PASSWORD@db:5432/bayline`. Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -hex 32`. Keep `.env` private. Provider fields may remain blank until configured.
3. From the repository root run `docker compose --env-file .env -f deploy/compose.yml up -d --build`. Caddy terminates HTTPS and is the only proxy. The application trusts exactly this one hop. PostgreSQL initialization creates a non-superuser application role; initialization runs only on a fresh volume. The web process initializes schema transactionally; worker startup may restart until it exists.
4. Set private `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` environment values for a one-off `docker compose ... exec -e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD web node scripts/admin.js`. This bootstraps only when no active owner exists. Do not put passwords into command arguments or shell history.
5. Sign in, configure member IDs and targets, connect approved providers, reconcile source reports, accept snapshots and test each role.

The web and worker use the same image/configuration. Use one web process during schema creation/upgrades. The worker polls durable jobs every three seconds. Running reads older than 20 minutes are marked failed; they do not retry an ambiguous OAuth refresh. The maximum 50-page GHL read is bounded below this timeout. Queue entries require a currently active owner at execution time. New data is always reviewed. No periodic reads or unattended approval are configured by default.

The deployment provides a non-root, read-only application filesystem, dropped capabilities and persistent PostgreSQL/Caddy volumes. Backups belong off-host, not solely inside the Docker volume. Container image tags should be pinned to approved digests by the operator for release reproducibility.

## Render / Railway

Deploy the Dockerfile as a web service, plus a background worker using `node backend/worker.js`, with one managed PostgreSQL 17 database. Set the public HTTPS APP_ORIGIN and secret variables in the platform environment. Use its assigned PORT for the web service. Run schema initialization/owner bootstrap as a one-off job before starting the worker. Build the same commit/image for both services. Use the provider's supported database TLS settings; do not disable certificate verification to force a connection.

Do not enable TRUST_SINGLE_PROXY unless the documented hosting topology has exactly one trusted reverse proxy and no direct public path to the service. Set a platform health check to `/api/health`. Verify real cookie/Origin/CSRF behavior at the deployed hostname, then record the URL and acceptance date. No Render/Railway resources or client DNS have been created by this repository.

## Password and session recovery

There is no email reset or SMTP dependency. An authorized operator sets ADMIN_EMAIL and a new ADMIN_PASSWORD privately and runs `node --env-file=.env scripts/admin.js --reset`. All that user's sessions are revoked and an activity entry is recorded. Deliver temporary credentials using the client's approved secure channel. Role, mapping and active-status changes also revoke sessions. At least one active owner is required.

Database access is administrative power. Use least privilege, rotate credentials and restrict host/secret-store access. Keep app and dependency updates in a reviewed CI release; audit logs are application history, not protection from a database superuser.

## Backup and restore drill

Back up PostgreSQL with the same major-version tools (17). For the bundled host:

```sh
docker compose --env-file .env -f deploy/compose.yml exec -T db pg_dump -U postgres -Fc bayline > bayline.dump
```

Encrypt and copy this dump off-host. Store the token encryption key and deployment configuration in a separate secure recovery store; the dump alone cannot recover encrypted OAuth tokens. Never commit dumps or secrets. Retain backups according to the client's financial-data/PII retention policy.

Restore into an isolated fresh database before touching production:

```sh
# Inside a PostgreSQL 17 administrative session/container:
createdb -U postgres -O bayline bayline_restore
pg_restore -U postgres --no-owner --role=bayline --exit-on-error -d bayline_restore bayline.dump
```

Start an isolated application with DATABASE_URL pointing to that restored database and the same encryption key. Disable all provider credentials/bridge senders while testing. Verify owner sign-in, accepted windows, role isolation, targets, review history and audit immutability. Invalidate restored sessions and OAuth states before a real cutover (`DELETE FROM sessions; DELETE FROM oauth_states;`). OAuth tokens may have rotated since the backup: delete the restored oauth_tokens rows and reconnect Intuit rather than replay an old refresh token. Review queued/running reads before restarting the worker. Record recovery time and reconcile sample source totals.

CI verifies restoration with fictional data, login password hashes, metrics and audit behavior. A full customer off-host restore drill, secret recovery and agreed recovery objectives remain client acceptance tasks.

## Monitoring and retention

Monitor database availability, disk growth, failed/stuck reads, missing/stale source warnings, unexpected sign-ins and CI dependency audits. HTTP errors avoid secrets. Configure request logs to omit bodies, cookies, OAuth query strings and authorization headers. Bridge endpoint availability can be monitored separately; it remains protected by per-source HMAC.

Snapshot and activity retention is intentionally not auto-pruned. Agree retention, deletion/export obligations and authorized maintenance procedures with the client before production. Follow-up references/staff identifiers may be personal data even when contact names are absent. Public demo credentials must never be installed on the live system.

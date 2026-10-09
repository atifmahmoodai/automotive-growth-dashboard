# Provider connections

All direct operations are read-only. Provide credentials through the deployment secret store, never snapshot files, browser storage or Git. Access tokens and refresh tokens for QuickBooks are AES-256-GCM encrypted in PostgreSQL using `TOKEN_ENCRYPTION_KEY`; private integration keys remain deployment secrets. Logs deliberately omit provider bodies, credentials and OAuth callback parameters. Configure reverse proxies not to log callback query strings.

Owner workflow: select an exact date window → Connections → Read selected period → worker prepares a review → refresh → inspect counts/amounts → accept. Failed reads retain the last accepted snapshot and show a safe diagnostic. Reads are not scheduled automatically. For repeat reporting, schedule an authenticated owner-approved operational process or the signed bridge, and retain explicit owner review. An unattended publish pipeline is deliberately not enabled.

## GoHighLevel

Set `GHL_TOKEN` to a sub-account private integration token with `opportunities.readonly`, and `GHL_LOCATION_ID` to the approved location. The connector uses `GET https://services.leadconnectorhq.com/opportunities/search`, `Version: v3`, `locationId`, `page`, `limit=100`, `status=all`.

It fetches the whole location, verifies `meta.total`, rejects changed totals/duplicates or more than 5,000 opportunities, then filters creation timestamps to business dates. If the actual account/version returns a different pagination shape, the read fails visibly; validate the response with the client and update the adapter instead of guessing. The API does not offer a transactional snapshot; reconcile totals and retry if source activity changes during a read.

Map optional `GHL_FIRST_CONTACT_FIELD` and `GHL_NEXT_FOLLOWUP_FIELD` to opportunity custom-field IDs containing explicit ISO timestamps (`customFields[].fieldValue`). Native `updatedAt` is never substituted. Missing mappings yield unknown response/follow-up coverage. Stage IDs are preserved by the direct connector; normalized imports can supply approved readable labels. Map `assignedTo` to workspace members' GoHighLevel IDs. No OAuth grant is necessary for this supported private-token mode.

Official reference: https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity/index.html

## TintWiz / normalized import bridge

TintWiz documents an owner-generated Zapier API key under Settings → Integrations. Use the authorized Zapier integration/export workflow to collect **complete** reporting windows and map jobs, refunds, service classifications, staff, bays and availability to [the contract](data-contract.md). A single "new job" webhook is not a complete window and must not be submitted as one. Use an external accumulator/export stage, then reconcile and submit. This repository supplies the receiving protocol and signing helper, not an installed client Zapier account or an undocumented direct REST connector.

Official reference: https://help.tintwiz.com/en/articles/4510358-using-zapier-to-integrate-tint-wiz-with-2000-apps

Set `BRIDGE_TINTWIZ_SECRET` to a random secret at least 32 characters long. Other normalized bridges use `BRIDGE_GHL_SECRET`, `BRIDGE_QBO_SECRET`, `BRIDGE_HYROS_SECRET`; blank disables the source endpoint. Only give a source its own key.

Protocol: POST `/bridge/{provider}`, Content-Type application/json, uncompressed UTF-8 bytes. Headers:

- `X-Bayline-Timestamp`: Unix seconds, within five minutes.
- `X-Bayline-Event`: stable 8–100 character ID (`A-Z`, `a-z`, digits, `_`, `-`).
- `X-Bayline-Signature`: hex HMAC-SHA256(secret, timestamp + `.` + event + `.` + exact body bytes).

A valid request queues a review (202), never auto-applies. Replaying the same event/payload returns the original review; changed contents under that ID conflict. For a retried HTTP delivery use a new timestamp/signature and the same event/body. For a genuinely new extraction use a new ID. To send a file from an authorized environment:

```sh
node --env-file=.env scripts/bridge.js complete-snapshot.json tintwiz-2026-01-v1
```

The helper validates and normalizes before signing. Secrets are never printed. TLS is mandatory for production. Rotate a compromised bridge secret in both sender and receiver.

## QuickBooks Online

Create an Intuit app for the approved company. Set `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REALM_ID` (digits), `TOKEN_ENCRYPTION_KEY` (64 hex characters), `QBO_BASIS=Accrual` or `Cash`, and `QBO_SANDBOX=true` for sandbox testing. Set sandbox false only with approved production credentials.

Register exactly `${APP_ORIGIN}/api/oauth/qbo/callback`. Owner → Connect with QuickBooks uses scope `com.intuit.quickbooks.accounting`; this is Intuit's accounting scope, while this app itself performs report reads only. State is random, single-use, expires in five minutes and is bound to the initiating owner session. A different company ID is rejected. The callback must return in the same signed-in browser.

Authorization: `https://appcenter.intuit.com/connect/oauth2`; exchange/refresh: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`. Access expiry is honored and the latest refresh token is persisted immediately after a successful exchange. Refresh claims are committed before network I/O. A timeout/crash/ambiguous exchange leaves a reconnect hold; a worker never blindly replays the old refresh token. Reconnect through the UI. Local Disconnect deletes stored tokens/states; revoke the app in Intuit separately when required.

P&L read: `/v3/company/{realm}/reports/ProfitAndLoss` with start_date, end_date, accounting_method and summarize_column_by=Total. Sandbox and production hosts are fixed; arbitrary provider URLs are not accepted. Dates, currency, basis, report name and total column shape must match. Stable groups Income, GrossProfit, Expenses and NetIncome are parsed, not translated display labels. An explicitly empty NoReportData report maps to zero; absent mandatory summaries otherwise fail. Client-specific report shapes need fixture and reconciliation acceptance before use.

Official references:
- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/profitandloss
- https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization
- https://github.com/intuit/oauth-jsclient

## Hyros

Set `HYROS_API_KEY`, `HYROS_TIMEZONE_CONFIRMED` to the exact agreed business/account timezone, and `HYROS_CAMPAIGNS` to a JSON array such as:

```json
[{"id":"native-campaign-id","name":"Window tint search","channel":"Google","level":"google_v2_campaign"}]
```

Supported campaign levels: facebook_campaign, google_campaign, google_v2_campaign, linkedin_campaign. Do not mix Google integration generations. Configure 1–50 unique nonoverlapping campaign IDs; the client must confirm that the set covers the intended spend and attribution universe. Other channels/levels can use normalized imports after agreeing a nonoverlapping mapping; do not sum parents and children.

Endpoint: `https://api.hyros.com/v1/api/v1.0/attribution`, `API-Key` header. Parameters: last_click, exact date bounds, configured currency, ALL_SOURCES, excludeHardCosts=false, source_link grouping, fields cost,total_revenue,leads. Only completed days are read directly because date-only end bounds resolve to end-of-day and Hyros refuses future bounds. Choose yesterday or earlier; use the same exact reporting window across sources. The UI defaults to month-to-date, so adjust it before a Hyros direct read.

Every configured ID must return exactly once. Missing IDs, extra pages, unknown amounts or unsupported precision fail instead of silently becoming zero. This conservative rule also rejects some legitimate empty campaign results; reconcile and use an explicit zero normalized export when needed. API numbers are required at cent precision. Ads are period totals, not a daily time series.

Official reference: https://api-docs.hyros.com/ and its REST API reference https://api-docs.hyros.com/ai-context/rest-api.txt . Contracts reviewed 2026-10-09. APIs can change; client sandbox response fixtures and reconciliation are required before live acceptance.

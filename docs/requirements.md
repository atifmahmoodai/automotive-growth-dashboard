# Requirement coverage and acceptance

The public brief defines a single-business automotive-growth dashboard, not a signed specification. This implementation uses React, Express/Node and PostgreSQL; private client code or schemas were not available.

| Brief requirement | Implemented behavior | Live acceptance input |
|---|---|---|
| GHL leads, pipeline, stages | Read-only v3 private-token adapter; full pagination; creation cohort; native stage IDs or normalized labels | Approved location/token, actual pagination/custom-field fixtures and staff/stage mapping |
| TintWiz jobs, service revenue, bay use | Strict completed-job/capacity contract, JSON upload and signed bridge, service analytics and coverage-aware utilization | Authorized Zapier/export accumulator, actual service/refund/staff/bay mapping, full-window reconciliation |
| QuickBooks P&L / margins | Session-bound OAuth2, encrypted rotating tokens, exact-date total P&L parser, owner-only accounting panel | Approved Intuit app/company, sandbox and production reconciliation, chosen accounting basis |
| Hyros spend, ROAS, CPL | Read-only nonoverlapping campaign report; fixed last-click/ALL_SOURCES; exact money and denominator handling | Actual campaign universe, account timezone/currency, response fixtures and UI comparison |
| Revenue target | Per-window integer-cent target, progress and below-target alert | Owner-approved period target; no forecast/pace claim |
| Speed-to-lead / follow-up | Median first-contact duration, coverage, open cohort follow-up list and overdue alerts | Explicit first-contact/follow-up timestamps, agreed opportunity-vs-contact definition |
| Close rate / team scorecards | Won/(won+lost), assigned-staff lead/job/revenue metrics, unmapped counts | Agreed creation cohort and native staff IDs |
| Alerts | In-app missing/stale source, revenue, response, close, ad return, overdue and over-capacity alerts | Threshold agreement; no external notification channels requested or enabled |
| Roles | Owner all; manager operations/ads/team; team only own assigned work with no monetary fields | Named users, least-privilege role acceptance |
| Mobile and clean UI | Responsive dashboard and admin screens, accessible labels, status/error feedback, desktop/mobile browser tests | Real-device/client visual acceptance |
| Hosting / handoff | Non-root Docker, Caddy + PG17 compose, managed-host instructions, operator account reset, backup/restore and CI | Actual host/domain/secrets, TLS/proxy checks, off-host recovery and support agreement |

## Tests and release evidence

The repository's GitHub Actions workflow is the source of current verification status. The suite exercises strict contracts, missing/zero/ratio behavior, team financial isolation, CSRF and sessions, import version conflicts/idempotency/expiry, bridge signing/replay, OAuth state/realm binding, encryption/refresh recovery, provider paging/report assumptions and queued-read failures. Native PostgreSQL, responsive browser workflows, restored database behavior and the non-root production image are separate checks.

Provider tests use explicit fixtures and mocked network responses. Live credentials and client data have not been supplied. Passing tests do not prove the client's API response shape, report completeness, timezone, attribution universe or operational definitions. Fail-closed behavior is intentional when these do not match.

## Before client launch

- Confirm currency/timezone and one-business scope; agree creation cohort, completed-job/refund treatment, service-line classification and bay capacity universe.
- Reconcile at least two reporting windows, including an empty period, refunds, lost/abandoned leads and a month boundary. Confirm provider-side record counts and totals before each first acceptance.
- Verify GHL pagination/mappings, the TintWiz export/Zapier aggregation, QBO P&L basis/group schema and Hyros nonoverlapping campaign coverage against actual approved accounts.
- Exercise each named user's role; ensure team account mappings are unique and correct. Test session revocation and operator reset.
- Test OAuth cancellation, wrong company, refresh rotation/reconnect and bridge duplicate/tampered deliveries in sandbox.
- Deploy the actual domain with HTTPS, keep database private, configure logs/monitoring/retention, and perform an off-host restore with key recovery and reconnect handling.
- Obtain owner acceptance and record deployed commit/URL/date. Source delivery and client launch are separate milestones.

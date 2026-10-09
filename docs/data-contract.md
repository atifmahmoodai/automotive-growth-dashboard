# Reporting contract and metric definitions

A source snapshot represents the **entire reporting set for one exact inclusive window**, from 1 to 93 business days. The dashboard never sums overlapping snapshots or guesses whether a partial export is complete. A snapshot for Jan 1–31 does not answer a Jan 2–31 request. The owner must reconcile the record count and totals before acceptance. Import APIs cannot independently prove completeness of a human export.

All root fields are required and extra fields are rejected:

```json
{
  "provider": "tintwiz",
  "start": "2026-01-01",
  "end": "2026-01-31",
  "currency": "USD",
  "timezone": "UTC",
  "observedAt": "2026-10-09T12:00:00Z",
  "records": []
}
```

`observedAt` is when the report was extracted, not its reporting period. Replace the illustrative timestamp with the real extraction time; it must be within the last seven days and no more than five minutes ahead. Data older than 24 hours receives a warning. A review expires after 30 minutes. All timestamps must be ISO 8601 with explicit timezone and seconds. Normalize money to integer cents; no currency conversion occurs. Dates are business dates in the configured timezone. Source IDs must be unique within the snapshot. Maximum: 5,000 records and 2 MB per import. Oversized/incomplete direct reports are rejected; they are never silently truncated.

An absent snapshot produces unknown values (`null`, shown as `—`). An accepted empty array explicitly means zero activity, except finance, which requires a complete explicit summary. Ratios with a zero or unknown denominator are unknown. No averaging of daily ratios, no inferred first-contact timestamps, no sum across revenue definitions.

## GoHighLevel records

```json
{"id":"opportunity-1","staffKey":"native-user-id","createdAt":"2026-01-02T12:00:00Z","firstContactAt":"2026-01-02T12:10:00Z","nextFollowupAt":"2026-01-03T16:00:00Z","status":"open","stage":"Consultation"}
```

`staffKey`, `firstContactAt` and `nextFollowupAt` may be null. Status: `open`, `won`, `lost`, `abandoned`. The creation date must fall within the reporting window. Stage can be a readable export label or the direct connector's native pipeline-stage ID. Opportunity IDs are the unit counted: multiple opportunities for one contact are separate leads in this view. If the business uses contact-based leads, it must agree and supply a deduplicated normalized mapping instead.

- Lead volume: opportunities created in the period, classified by status as observed.
- Close rate: won / (won + lost). Open and abandoned excluded. This is a creation-cohort measure, not count of deals closed during the period.
- Speed-to-lead: median (first contact − creation), minutes, among supplied first-contact timestamps only. Coverage = supplied timestamps / total leads. No timestamp means unknown response, not instantaneous response.
- Follow-up coverage: open opportunities with a supplied next follow-up / open opportunities. Overdue = open with next follow-up before current time. Future reporting windows do not turn historical follow-ups into completed tasks.
- Team: exact native staff-ID mapping, one user per ID. Unmapped leads/jobs are counted separately; they never fall into a team member's view. Disabled members remain historical mappings, but are omitted from active team scorecards.

## TintWiz completed jobs and capacity

```json
{"kind":"job","id":"job-1","day":"2026-01-02","staffKey":"native-staff-id","service":"PPF","amountCents":125000,"refundCents":5000,"bay":"Bay 1","bayMinutes":180}
```

`day` is completion business date. `service`: Tint, Ceramic, PPF, Wrap or Other. `amountCents` is completed-job service revenue excluding sales tax; refunds are allocated to the original completed job and cannot exceed its amount. Agree this treatment with the client. No open estimates, deposits treated as separate revenue, or duplicate invoice lines. For multi-service jobs, allocate amounts/minutes to unique service-line IDs and document that the displayed "jobs" then means completed service lines; default mapping expects one service classification per completed job. This classification must be settled before client acceptance.

`staffKey` and `bay` can be null. Bay minutes count recorded completed-job occupancy, not future bookings. Unknown occupied minutes cannot be inferred: the mapping must supply them. Availability is explicit:

```json
{"kind":"capacity","id":"bay1-2026-01-02","day":"2026-01-02","bay":"Bay 1","minutes":480}
```

Exactly one capacity row per bay/day. Include **every operating bay/day** in the window, including days with no completed jobs. Utilization is used minutes / available minutes. Missing capacity for any job's bay/day, or positive minutes with no bay assignment, makes it unknown. Utilization over 100% is retained with an alert, exposing overlaps rather than clamping them. Partial capacity data for unused bays cannot be detected automatically; owner reconciliation is mandatory.

Service revenue: amount minus refund. Daily chart fills zero days only inside a known complete accepted snapshot. Service mix and targets use the same measure.

## Hyros campaign records

```json
{"id":"campaign-1","channel":"Google","campaign":"Tint search","spendCents":120000,"revenueCents":600000,"leads":50,"model":"last_click"}
```

Nonoverlapping campaigns at one agreed level per platform. Revenue is attributed total revenue, including the provider's recurring-revenue treatment, with hard-cost exclusion disabled. Model is fixed to last click; source configuration ALL_SOURCES. ROAS = attributed total revenue / spend. CPL = spend / leads. Null leads produce unknown CPL. No spend produces unknown ROAS; no leads produces unknown CPL. Daily ad trend is not fabricated from period aggregates.

## QuickBooks P&L

```json
{"id":"profit-and-loss","basis":"Accrual","incomeCents":1000000,"cogsCents":250000,"expensesCents":300000,"netCents":460000}
```

Exactly one row, `basis` Cash or Accrual. Signed cents supported. COGS = report income − gross profit. Net income comes from the report's NetIncome group, including other income/expenses; it is not reconstructed from the three displayed categories. Net margin = net income / accounting income. Finance is owner-only. Do not add accounting income to service or attributed revenue.

## Acceptance and history

An owner previews every normalized row and explicitly accepts or rejects. Acceptance replaces that source/window atomically. Provider-global version checks prevent two reviewed imports from racing even across windows; re-import after another acceptance. Older observations cannot replace newer accepted observations. Re-applying an already accepted batch is idempotent. Activity is append-only at the database trigger level; a privileged database administrator can still modify schema/data and is outside this application boundary.

# QA feedback — 2026-06-02

Raw list captured from Lalit during walk-through of `crm.whitecollarrealty.com`.

## Bucket A — Leads / Duplication (BLOCKER)
- India and Dubai sections show the SAME lead in BOTH — must de-dup.
- Repeated query (same email + phone) — keep one record, but track that it
  came in multiple times; assign to one owner.
- Cold data: repeated numbers are showing as separate leads. Investor flag
  should de-dup.
- Buyer list: every lead's number / email / name should be verified before
  showing up as a buyer.

## Bucket B — Lead detail UI / BANT
- BANT details should be filled per lead (Budget / Authority / Need / Timeline).
- Remove the "why" panel — replace with green / red signals.
- Timeline missing.
- Profession and Company should be one field (side by side, not separate).
- Add Project: should be auto-complete (type-ahead) not free text.
- Interested properties section needs to be present.
- Sticky note on each lead.
- WhatsApp history + connected-call log should merge into one timeline.
- Repeated entries: maintain in one place per lead.

## Bucket C — Dashboard / "Sales Floor Live"
- "Sales floor live" — what does it actually mean / show? Needs labels.
- "Complete" — is that new + follow-up? Make it clear.
- Time-range: span months when >30 days; days when ≤30 days.
- "Why is investment showing up?" — the client tag/segment is unclear.
- Top-5 action list — what's the logic? Needs explanation on hover.
- "Selling leads" label — what does it mean?
- Leaderboard — needs review.
- Star of the month — definition + criteria.
- Stalled deals: clicking should jump to pipeline.

## Bucket D — Reports
- Print button — remove.
- CSV export should NOT contain agents column.
- "Copy snapshot — agents CSV" — clarify intent.
- Best time to call — "AM/PM" / time-zone (IST) is wrong.
- Daily report: pick from calendar.
- Reports page: needs a back button in the web view.
- All reports: add a calendar filter.
- YTD report.

## Bucket E — Cold / Cooling / Warm / Hot
- Cold-to-warm transition rules.
- "Cooling leads" definition.
- Warm / hot / cool — should be AI-driven, not just keyword.
- Buying-signal — definition needed.
- "Why this score" — show the reason.
- Revival engine — add to leads.

## Bucket F — Logging / Activity
- Log meeting — only allow scheduling up to 1 week ahead.
- Log home visit / site visit — needs flow.
- "To do" list — remove.
- "Location: Delhi" shown twice — remove duplicate.

## Bucket G — Admin / Source / Reject
- Reject lead: remove from agent's view, keep visible in admin.
- Source field: hide from agent (show only to admin).
- Smart CMA — what is it / needs definition.
- EOI — needs handling / flow.

## Bucket H — Voice / Motivation
- Motivation from history (past wins).
- Voice record capture.

## Bucket I — Hour / Quality
- "Quality" of an agent's day — how is it defined? hours / dates / month / week?

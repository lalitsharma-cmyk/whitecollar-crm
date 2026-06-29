# HR Candidates List — Sales-Leads Parity Spec (Lalit, 2026-06-28)

Goal: the Candidate List should feel almost identical to the Sales Leads list. REUSE Sales components/UX, don't rebuild. A Sales-CRM user should feel instantly familiar.

Reuse: `src/components/ColumnHeaderFilter.tsx` (Excel filters — already used by Buyer/Master-Data), `HRSavedFilter` + `/api/hr/saved-filters` (saved views — exists), `hrStatus.ts` statusColor/displayStatus (badges — exists), Sales Leads sticky/density patterns in `LeadsListClient.tsx`.

1. **Excel-style column filters** on every header (search-in-values, multi-select, sort A→Z / Z→A, clear) — via shared ColumnHeaderFilter. Columns: Created Date, Candidate Name, Phone, Current Profile, Experience, Current Salary, Expected Salary, Status, Next Action, Follow-up, Interview, Owner, Last Activity.
2. **Column order:** Created Date · Candidate Name · Phone · Position Applied · Current Profile · Experience · Current Salary · Expected Salary · Current Status · Next Action · Follow-up Date · Interview · Owner · Last Activity. Created Date always first.
3. **Reduce width/density** — less horizontal scroll, more rows visible, like Sales table.
4. **Phone** — `tel:` (dialer on mobile / call on desktop); never plain text. (already partially)
5. **Quick action icons per row:** Call, WhatsApp, Voice Note, Email, Schedule Interview, Add Note, Open. Reuse Sales icon style.
6. **Voice Notes** — DONE (HRCandidateVoice in detail). List should expose the Voice Note quick action → candidate voice.
7. **Conversation History** — DONE (unified timeline in detail). 
8. **Sticky header** — fixed on scroll.
9. **Sticky first columns** — Created Date, Candidate Name, Phone fixed on horizontal scroll.
10. **Status badges** — color-coded (hrStatus colors) in the table, not plain text.
11. **Row click** — anywhere on row opens candidate profile; quick-action buttons stopPropagation.
12. **Hover preview** — Last Note, Last Call Date, Last Follow-up, Recruiter, Resume Available, Current Stage — without opening profile.
13. **Saved Views (enhanced)** — presets: Today's Calls, Interview Today, Salary Above ₹50K, Team Leader Candidates, Gurgaon Candidates, Dubai Candidates. Like Sales saved filters.
14. **UX goal** — near-identical to Sales Leads list; reuse proven components; zero extra training.

Scope/RBAC: keep hrActiveScopeWhere(me) (Junior=own) + deletedAt:null on the list query (already enforced in candidates/page.tsx + /api/hr/candidates).

STATUS: QUEUED behind the HR dashboard redesign batch (serial deploys). Primary files: src/components/HRCandidateTable.tsx, src/app/(hr)/hr/candidates/page.tsx, reuse ColumnHeaderFilter; maybe a new HRCandidateRowPreview component.

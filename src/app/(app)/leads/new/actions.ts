"use server";
// Server action backing the floating "+" quick-add-lead FAB (QuickAddLeadFab).
//
// It REUSES the exact same create path as the full /leads/new form: it calls
// `ingestLead()` — the single source of truth for lead creation (phone E.164
// normalisation, dedupe-by-fingerprint, default "today EOD" follow-up, SLA,
// admin notifications, speed-to-lead + workflow triggers). The only difference
// from the full form's `createLeadAction` is:
//   • collects ONLY the essentials (name + phone + a few optionals),
//   • sends sensible defaults for everything else,
//   • RETURNS JSON ({ ok, leadId }) instead of redirect() — so the FAB can show
//     a toast + "Open lead" link + "Add another" reset without leaving the page.

import { ingestLead } from "@/lib/leadIngest";
import { LeadSource } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toE164 } from "@/lib/phone";
import { parseBudget } from "@/lib/budgetParse";

export interface QuickAddResult {
  ok: boolean;
  leadId?: string;
  error?: string;
}

export async function quickCreateLeadAction(
  _prev: QuickAddResult | null,
  formData: FormData,
): Promise<QuickAddResult> {
  try {
    // Server Functions are reachable via direct POST — always re-check auth here.
    await requireUser();

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "Name is required." };

    // PhoneInput-style normalisation: store canonical E.164 (same as full form).
    const rawPhone = String(formData.get("phone") ?? "").trim();
    const phone = toE164(rawPhone) ?? undefined;
    if (!phone) return { ok: false, error: "A valid phone number is required." };

    // Source — accept any valid LeadSource; manual/walk-in entries map to OTHER.
    const sourceRaw = String(formData.get("source") ?? "OTHER");
    const source = (Object.values(LeadSource) as string[]).includes(sourceRaw)
      ? (sourceRaw as LeadSource)
      : LeadSource.OTHER;

    // Team drives currency downstream (Dubai → AED, India → INR) via ingestLead.
    const teamRaw = String(formData.get("forwardedTeam") ?? "").trim();
    const team = teamRaw === "Dubai" || teamRaw === "India" ? teamRaw : undefined;

    // Budget is one optional free-text field on the FAB. Parse "2.5M"/"30L"/"3Cr"
    // shorthand and treat it as budgetMax (the figure agents jot down first).
    const budgetRaw = String(formData.get("budget") ?? "").trim();
    const budgetMax = budgetRaw ? parseBudget(budgetRaw) ?? undefined : undefined;

    const notes = String(formData.get("remarks") ?? "").trim() || undefined;

    const { lead } = await ingestLead({
      name,
      phone,
      budgetMax,
      notesShort: notes,
      source,
      team,
    });

    // Mirror the full form: also persist remarks into the rich `remarks` column
    // so the lead-detail page shows the captured situation immediately, and keep
    // the budget exactly as the agent typed it (budgetRaw is the display source).
    const post: Record<string, unknown> = {};
    if (notes) post.remarks = notes;
    if (budgetRaw) post.budgetRaw = budgetRaw;
    if (Object.keys(post).length) {
      await prisma.lead.update({ where: { id: lead.id }, data: post });
    }

    return { ok: true, leadId: lead.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add lead." };
  }
}

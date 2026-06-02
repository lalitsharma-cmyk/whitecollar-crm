// Smart CMA — dual-mode endpoint.
//
//   Default (Accept: application/json OR ?format=json) → JSON for the
//   SmartCMACard:  { anchor, comparables, aiNarrative? }.
//
//   Browser download / ?format=pdf → branded buyer-facing PDF (legacy
//   behaviour, used by the "Download CMA" anchor on the lead page).
//
// The dual-mode keeps the existing `<a download href="…/cma">` link working
// while letting the new card fetch structured data from the same URL.
//
// JSON shape (per Agent N's spec):
//   - anchor: the lead's interested unit (PRIMARY first) used as the price
//     reference, or null when there's no interest pinned.
//   - comparables: up to 3 AVAILABLE Unit rows with their Project loaded,
//     matched on configuration, ±20% carpetArea, ±15% priceBase, and same
//     city (preferred) or area, excluding the anchor + any other unit the
//     lead is already interested in. Sorted by smallest |priceBase − anchor|.
//   - aiNarrative: optional 5-line paragraph from Claude / Gemini comparing
//     anchor + comparables on price/sqft, view, floor, project status. Only
//     present when an AI provider is configured AND the call succeeded.
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { bestUnitsForLead } from "@/lib/inventoryMatch";
import { renderCmaPdf } from "@/lib/cmaPdf";
import { audit, reqMeta } from "@/lib/audit";
import { aiEnabled, generateText } from "@/lib/ai";
import { teamToCountry } from "@/lib/propertyScope";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type UnitWithProject = Prisma.UnitGetPayload<{ include: { project: true } }>;

// Decide JSON vs PDF. Default = JSON (spec). PDF only when explicitly asked.
function wantsJson(req: NextRequest): boolean {
  const fmt = req.nextUrl.searchParams.get("format")?.toLowerCase();
  if (fmt === "pdf") return false;
  if (fmt === "json") return true;
  const accept = req.headers.get("accept") ?? "";
  // <a download> sends Accept: */* (or text/html on some browsers). Treat
  // anything that doesn't explicitly ask for JSON as a PDF download to
  // preserve the existing on-page link.
  return accept.includes("application/json");
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const json = wantsJson(req);

  if (!json) {
    // ─── PDF path (legacy "Download CMA" anchor) ──────────────────────────
    const [lead, units] = await Promise.all([
      prisma.lead.findUnique({ where: { id } }),
      bestUnitsForLead(id, 3),
    ]);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const pdf = await renderCmaPdf({ lead, agent: me, units });
    await audit({
      userId: me.id,
      action: "lead.cma.download",
      entity: "Lead",
      entityId: id,
      meta: { leadName: lead.name, unitCount: units.length },
      request: reqMeta(req),
    });
    const filename = `WCR-${lead.name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`;
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.length),
      },
    });
  }

  // ─── JSON path (SmartCMACard) ───────────────────────────────────────────
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true,
      city: true,
      configuration: true,
      forwardedTeam: true,
      interestedUnits: {
        orderBy: [{ createdAt: "asc" }],
        include: { unit: { include: { project: true } } },
      },
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Team-scoped country filter for comparables. Admin/manager bypass — they
  // can compare across countries. Agents see only same-team comparables, with
  // team derived from the LEAD (forwardedTeam) not the agent (so cross-team
  // hand-offs still surface the right comparables). Null forwardedTeam ⇒ no
  // country filter (lead is still in admin triage).
  const isPrivileged = me.role === "ADMIN" || me.role === "MANAGER";
  const scopeCountry = isPrivileged ? null : teamToCountry(lead.forwardedTeam);

  // Anchor = the lead's first interested unit, with PRIMARY rows preferred
  // over COMPARE / RULED_OUT. Enum-sort in SQL would be alphabetic (COMPARE
  // first), so we promote in JS instead.
  const primary = lead.interestedUnits.find((lp) => lp.type === "PRIMARY");
  const anchor: UnitWithProject | null =
    primary?.unit ?? lead.interestedUnits[0]?.unit ?? null;
  const excludeUnitIds = lead.interestedUnits.map((lp) => lp.unitId);

  // Derive the matching profile. If we have an anchor, lean on it (most
  // accurate). Otherwise fall back to lead.configuration + lead.city.
  const configuration: string | null = anchor?.configuration ?? lead.configuration ?? null;
  const city: string | null = anchor?.project.city ?? lead.city ?? null;
  const area: string | null = anchor?.project.area ?? null;
  const refCarpet: number | null = anchor?.carpetArea ?? null;
  const refPrice: number | null = anchor?.priceBase ?? null;

  let comparables: UnitWithProject[] = [];
  if (configuration) {
    // Build the WHERE clause from the rules in the spec.
    //   - Same configuration (case-sensitive: matches the seeded format)
    //   - status: AVAILABLE
    //   - Exclude any unit the lead is already pinned to
    //   - ±20% carpetArea if known
    //   - ±15% priceBase if known
    //   - Same city preferred; fall back to same area if no anchor city
    //   - Same team country when caller is an AGENT (admin/manager bypass)
    const projectFilter: Prisma.ProjectWhereInput = {
      ...(city ? { city } : area ? { area } : {}),
      ...(scopeCountry ? { country: scopeCountry } : {}),
    };
    const where: Prisma.UnitWhereInput = {
      status: "AVAILABLE",
      configuration,
      ...(excludeUnitIds.length ? { id: { notIn: excludeUnitIds } } : {}),
      ...(refCarpet != null && refCarpet > 0
        ? { carpetArea: { gte: refCarpet * 0.8, lte: refCarpet * 1.2 } }
        : {}),
      ...(refPrice != null && refPrice > 0
        ? { priceBase: { gte: refPrice * 0.85, lte: refPrice * 1.15 } }
        : {}),
      ...(Object.keys(projectFilter).length ? { project: projectFilter } : {}),
    };
    // Over-fetch and rank in JS — Prisma can't sort by |x - anchor| natively.
    const pool = await prisma.unit.findMany({
      where,
      include: { project: true },
      take: 24,
      orderBy: { priceBase: "asc" },
    });

    // Fallback: if city was strict and we found nothing, retry by area.
    let widened = pool;
    if (widened.length === 0 && city && area) {
      widened = await prisma.unit.findMany({
        where: {
          ...where,
          project: {
            area,
            ...(scopeCountry ? { country: scopeCountry } : {}),
          },
        },
        include: { project: true },
        take: 24,
        orderBy: { priceBase: "asc" },
      });
    }

    if (refPrice != null && refPrice > 0) {
      widened.sort(
        (a, b) => Math.abs(a.priceBase - refPrice) - Math.abs(b.priceBase - refPrice),
      );
    }
    comparables = widened.slice(0, 3);
  }

  // ─── Optional AI narrative ──────────────────────────────────────────────
  let aiNarrative: string | undefined;
  if (aiEnabled() && (anchor || comparables.length > 0)) {
    try {
      const narrative = await generateText({
        system:
          "You are a senior Dubai real-estate analyst. Output exactly 5 short lines comparing the anchor unit with the comparables on price-per-sqft, view, floor, and project status. No preamble. No markdown. No bullet points — just 5 plain lines separated by newlines.",
        prompt: buildNarrativePrompt(anchor, comparables),
        maxTokens: 260,
      });
      const cleaned = narrative?.trim();
      if (cleaned) aiNarrative = cleaned;
    } catch {
      // AI failure is non-fatal — the card still renders without narrative.
    }
  }

  return NextResponse.json({
    anchor,
    comparables,
    aiNarrative,
  });
}

function buildNarrativePrompt(
  anchor: UnitWithProject | null,
  comparables: UnitWithProject[],
): string {
  const lineFor = (u: UnitWithProject, tag: string) => {
    const psf = u.carpetArea && u.carpetArea > 0 ? Math.round(u.priceBase / u.carpetArea) : null;
    return [
      `${tag}: ${u.project.name} ${u.code}`,
      `cfg=${u.configuration}`,
      u.carpetArea ? `carpet=${u.carpetArea} sqft` : null,
      `price=${u.priceBase.toLocaleString()}`,
      psf ? `psf=${psf}` : null,
      u.floor != null ? `floor=${u.floor}` : null,
      u.view ? `view=${u.view}` : null,
      `projectStatus=${u.project.status}`,
      `area=${u.project.area ?? u.project.city}`,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const lines: string[] = [];
  if (anchor) lines.push(lineFor(anchor, "ANCHOR"));
  comparables.forEach((c, i) => lines.push(lineFor(c, `COMP${i + 1}`)));

  return `Write a 5-line CMA paragraph comparing the anchor unit against the comparables below. Cover: (1) price-per-sqft positioning, (2) view, (3) floor band, (4) project status/handover, (5) which comp is the best alternative and why. Use plain prose — no bullets, no markdown, no headings. Keep it under 100 words total.

${lines.join("\n")}`;
}

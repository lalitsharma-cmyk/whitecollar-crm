// Pure TypeScript project detection — no external dependencies.
// Scans all text fields of a lead and matches against known Project names.
//
// STRICT matching policy (per Lalit's request):
//   - Project must be explicitly named in the text.
//   - Developer brand alone ("Emaar", "Sobha") is NOT sufficient.
//   - Exact phrase match is required, OR ALL distinctive non-brand tokens match.
//   - A match here goes into LeadProject with suggestion=true (pending review).
//   - User must Accept before it appears in "Projects Discussed".

export interface TextSource {
  text: string;
  sourceType: "REMARK" | "CALL_NOTE" | "WA_MESSAGE" | "NOTE" | "MANUAL";
  sourceDate: Date;
}

export interface ProjectMatch {
  projectId: string;
  projectName: string;
  sourceType: string;
  sourceDate: Date;
  sourceText: string; // ≤200 char excerpt
}

export interface UnmatchedMentionData {
  mentionText: string;
  sourceType: string;
  sourceDate: Date;
  sourceText: string; // ~150 char excerpt
}

export interface InterestNoteData {
  noteText: string;
  sourceType: string;
  sourceDate: Date;
}

export interface DetectionResult {
  projectMatches: ProjectMatch[];
  unmatchedMentions: UnmatchedMentionData[];
  interestNotes: InterestNoteData[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "over", "under",
  "than", "this", "that", "city", "real", "estate", "project",
  "tower", "residences", "heights", "plaza", "suites", "villas",
  "gardens", "views", "hills", "valley", "bay", "creek", "park",
  "south", "north", "east", "west", "central", "grand", "new", "old",
]);

// Developer brand names — a brand alone is NOT a project match. Brand +
// project-specific tokens are required.
const DEVELOPER_BRANDS = new Set([
  "emaar", "sobha", "danube", "damac", "omniyat", "nakheel", "azizi",
  "binghatti", "meraas", "ellington", "meydan", "wasl", "reportage",
  "godrej", "lodha", "dlf", "shapoorji", "prestige", "puravankara",
  "brigade", "tata", "mahindra", "oberoi", "rustomjee", "hiranandani",
]);

// Area names used in interest-note detection
const AREA_NAMES = [
  "business bay", "dubai marina", "downtown", "jvc", "jvt", "jbr",
  "jumeirah", "palm jumeirah", "arabian ranches", "creek", "gurgaon",
  "noida", "sector", "golf course", "dlf", "dwarka", "faridabad",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize to lowercase alphanumeric only. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Tokenize a project name into DISTINCTIVE tokens only.
 * - Splits on non-alphanumeric boundaries
 * - Filters stopwords AND developer brand names
 * - Keeps only tokens ≥4 chars (3-char tokens are too generic)
 */
function tokenize(name: string): string[] {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t) && !DEVELOPER_BRANDS.has(t));
}

/**
 * Build an excerpt (≤200 chars) around a match position in original text.
 */
function buildExcerpt(text: string, token: string, maxLen = 200): string {
  const lower = text.toLowerCase();
  const pos = lower.indexOf(token.toLowerCase());
  if (pos === -1) {
    return text.length <= maxLen ? text : text.slice(0, maxLen) + "…";
  }
  const start = Math.max(0, pos - 80);
  const end = Math.min(text.length, pos + token.length + 80);
  const excerpt = text.slice(start, end);
  return (start > 0 ? "…" : "") + excerpt + (end < text.length ? "…" : "");
}

// ---------------------------------------------------------------------------
// Core detection
// ---------------------------------------------------------------------------

export function detectProjectsAndInterests(
  sources: TextSource[],
  allProjects: Array<{ id: string; name: string; city: string }>
): DetectionResult {
  const projectMatches: ProjectMatch[] = [];
  const unmatchedMentions: UnmatchedMentionData[] = [];
  const interestNotes: InterestNoteData[] = [];

  // Pre-compute tokens + exact lowercase name for each project
  const projectTokens: Array<{
    id: string;
    name: string;
    nameLower: string;
    tokens: string[];
  }> = allProjects.map((p) => ({
    id: p.id,
    name: p.name,
    nameLower: p.name.toLowerCase(),
    tokens: tokenize(p.name),
  }));

  // Track seen interest note signatures to deduplicate across sources
  const seenInterestSigs = new Set<string>();

  for (const src of sources) {
    if (!src.text || !src.text.trim()) continue;
    const text = src.text;
    const lower = text.toLowerCase();

    // -----------------------------------------------------------------------
    // 1. Project matching — two-pass: exact phrase first, then all-tokens
    // -----------------------------------------------------------------------
    for (const proj of projectTokens) {
      // ── Pass 1: exact phrase match (case-insensitive) ──────────────────────
      // "Sobha Hartland 2" must appear verbatim (modulo case) in the text.
      // This is the high-confidence path and virtually zero false-positives.
      if (lower.includes(proj.nameLower)) {
        const sourceText = buildExcerpt(text, proj.nameLower, 200);
        projectMatches.push({
          projectId: proj.id,
          projectName: proj.name,
          sourceType: src.sourceType,
          sourceDate: src.sourceDate,
          sourceText,
        });
        continue; // no need to check tokens if exact match found
      }

      // ── Pass 2: ALL distinctive tokens must appear ─────────────────────────
      // Requires ≥2 distinctive tokens; brand name alone never counts.
      // E.g. "Hartland 2" (sobha stripped, "2" short → only "hartland") →
      // doesn't satisfy ≥2 rule → no match. Prevents brand-only false positives.
      const tokens = proj.tokens;
      if (tokens.length < 2) continue; // not enough evidence without exact match

      let allMatch = true;
      let matchToken: string | null = null;
      for (const t of tokens) {
        if (!norm(lower).includes(t)) {
          allMatch = false;
          break;
        }
        if (!matchToken) matchToken = t;
      }

      if (allMatch && matchToken) {
        const sourceText = buildExcerpt(text, matchToken, 200);
        projectMatches.push({
          projectId: proj.id,
          projectName: proj.name,
          sourceType: src.sourceType,
          sourceDate: src.sourceDate,
          sourceText,
        });
      }
    }

    // -----------------------------------------------------------------------
    // 2. Unmatched mention detection — developer brand + extra words
    // -----------------------------------------------------------------------
    for (const brand of [...DEVELOPER_BRANDS]) {
      let searchFrom = 0;
      while (true) {
        const brandPos = lower.indexOf(brand, searchFrom);
        if (brandPos === -1) break;

        // Require word boundary
        const charBefore = brandPos > 0 ? lower[brandPos - 1] : " ";
        const charAfter = lower[brandPos + brand.length] ?? " ";
        const atWordBoundary = /[^a-z0-9]/.test(charBefore) && /[^a-z0-9]/.test(charAfter);

        if (atWordBoundary) {
          const afterBrand = text.slice(brandPos + brand.length).trimStart();
          const additionalWords = afterBrand.match(/^([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+){0,2})/);

          if (additionalWords && additionalWords[1].trim().length > 0) {
            const mentionText = text.slice(brandPos, brandPos + brand.length) + " " + additionalWords[1].trim();

            // Skip if this mention resolves to a known project (already in matches above)
            const mentionNorm = norm(mentionText);
            let matchesKnown = false;
            for (const p of projectTokens) {
              if (p.nameLower && norm(p.nameLower).includes(norm(additionalWords[1].trim()))) {
                matchesKnown = true;
                break;
              }
            }

            if (!matchesKnown) {
              const sourceText = buildExcerpt(text, mentionText.slice(0, 20), 150);
              unmatchedMentions.push({
                mentionText: mentionText.slice(0, 100),
                sourceType: src.sourceType,
                sourceDate: src.sourceDate,
                sourceText,
              });
            }
          }
        }

        searchFrom = brandPos + brand.length;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Interest note detection — config (BHK/BR) + area + optional price
    // -----------------------------------------------------------------------
    const configRegex = /(\d+)\s*(BHK|BR|bedroom|bedrooms)/gi;
    let configMatch: RegExpExecArray | null;

    while ((configMatch = configRegex.exec(text)) !== null) {
      const configStr = `${configMatch[1]}${configMatch[2].toUpperCase().replace(/BEDROOMS?/i, "BR")}`;
      const matchPos = configMatch.index;
      const windowStart = Math.max(0, matchPos - 120);
      const windowEnd = Math.min(text.length, matchPos + configMatch[0].length + 120);
      const window = text.slice(windowStart, windowEnd).toLowerCase();

      let foundArea: string | null = null;
      for (const area of AREA_NAMES) {
        if (window.includes(area.toLowerCase())) {
          foundArea = area;
          break;
        }
      }
      if (!foundArea) continue;

      const areaFormatted = foundArea
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      let priceStr: string | null = null;
      const pricePatterns = [
        /AED\s*(\d+(?:\.\d+)?)\s*M/i,
        /(\d+(?:\.\d+)?)\s*Cr(?:ore)?/i,
        /(\d+(?:\.\d+)?)\s*Lakh/i,
        /AED\s*([\d,]+)/i,
      ];
      const windowForPrice = text.slice(windowStart, windowEnd);
      for (const priceRe of pricePatterns) {
        const priceMatch = priceRe.exec(windowForPrice);
        if (priceMatch) {
          if (/AED\s*[\d.]+\s*M/i.test(priceMatch[0])) priceStr = `AED ${priceMatch[1]}M`;
          else if (/Cr/i.test(priceMatch[0])) priceStr = `${priceMatch[1]} Cr`;
          else if (/Lakh/i.test(priceMatch[0])) priceStr = `${priceMatch[1]} Lakh`;
          else if (/AED\s*[\d,]+/i.test(priceMatch[0])) priceStr = `AED ${priceMatch[1]}`;
          break;
        }
      }

      const noteText = priceStr
        ? `${configStr} ${areaFormatted} (${priceStr} budget)`
        : `${configStr} ${areaFormatted}`;

      const sig = `${configStr}|${areaFormatted}`;
      if (!seenInterestSigs.has(sig)) {
        seenInterestSigs.add(sig);
        interestNotes.push({ noteText, sourceType: src.sourceType, sourceDate: src.sourceDate });
      }
    }
  }

  // Deduplicate projectMatches by projectId — keep the one from the most
  // specific source (call note > WA > remark > note)
  const sourceOrder = ["CALL_NOTE", "WA_MESSAGE", "REMARK", "NOTE", "MANUAL"];
  const best = new Map<string, ProjectMatch>();
  for (const m of projectMatches) {
    const existing = best.get(m.projectId);
    if (!existing) { best.set(m.projectId, m); continue; }
    const existingRank = sourceOrder.indexOf(existing.sourceType);
    const newRank = sourceOrder.indexOf(m.sourceType);
    if (newRank < existingRank) best.set(m.projectId, m);
  }

  return {
    projectMatches: [...best.values()],
    unmatchedMentions,
    interestNotes,
  };
}

// ---------------------------------------------------------------------------
// Helper to build TextSource[] from a lead's hydrated data
// ---------------------------------------------------------------------------

export function buildSourcesFromLead(lead: {
  remarks?: string | null;
  notesShort?: string | null;
  notes: Array<{ body: string; createdAt: Date }>;
  callLogs: Array<{ notes?: string | null; startedAt: Date }>;
  waMessages: Array<{ body: string; receivedAt: Date }>;
}): TextSource[] {
  const sources: TextSource[] = [];
  const now = new Date();

  if (lead.remarks && lead.remarks.trim()) {
    sources.push({ text: lead.remarks, sourceType: "REMARK", sourceDate: now });
  }
  if (lead.notesShort && lead.notesShort.trim()) {
    sources.push({ text: lead.notesShort, sourceType: "NOTE", sourceDate: now });
  }
  for (const note of lead.notes) {
    if (note.body && note.body.trim()) {
      sources.push({ text: note.body, sourceType: "NOTE", sourceDate: note.createdAt });
    }
  }
  for (const cl of lead.callLogs) {
    if (cl.notes && cl.notes.trim()) {
      sources.push({ text: cl.notes, sourceType: "CALL_NOTE", sourceDate: cl.startedAt });
    }
  }
  for (const wa of lead.waMessages) {
    if (wa.body && wa.body.trim()) {
      sources.push({ text: wa.body, sourceType: "WA_MESSAGE", sourceDate: wa.receivedAt });
    }
  }

  return sources;
}

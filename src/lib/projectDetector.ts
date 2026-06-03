// Pure TypeScript project detection — no external dependencies.
// Scans all text fields of a lead and fuzzy-matches against known Project names
// to auto-detect which projects were discussed, plus unmatched developer-brand
// mentions and interest notes (config + area + price).

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
  "tower", "residences", "heights", "plaza",
]);

// Known developer brand names (lowercase for comparison)
const DEVELOPER_BRANDS = [
  "emaar", "sobha", "danube", "damac", "omniyat", "nakheel", "azizi",
  "binghatti", "meraas", "ellington", "meydan", "wasl", "reportage",
];

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
 * Tokenize a project name into distinctive tokens.
 * - Splits on non-alphanumeric boundaries
 * - Filters stopwords
 * - Keeps only tokens ≥3 chars
 */
function tokenize(name: string): string[] {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Build an excerpt (≤200 chars) around a match position in original text.
 * Finds the token in the original text (case-insensitive) and takes ±80 chars.
 */
function buildExcerpt(text: string, token: string, maxLen = 200): string {
  const lower = text.toLowerCase();
  const pos = lower.indexOf(token.toLowerCase());
  if (pos === -1) {
    // Fallback: return the beginning
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

  // Pre-compute tokens for each project
  const projectTokens: Array<{
    id: string;
    name: string;
    tokens: string[];
  }> = allProjects.map((p) => ({
    id: p.id,
    name: p.name,
    tokens: tokenize(p.name),
  }));

  // Build a set of all known project normalized names (for unmatched-mention dedup)
  const knownProjectNormNames = new Set(
    allProjects.map((p) => norm(p.name))
  );

  // Track seen interest note signatures to deduplicate across sources
  const seenInterestSigs = new Set<string>();

  for (const src of sources) {
    if (!src.text || !src.text.trim()) continue;
    const text = src.text;
    const normText = norm(text);

    // -----------------------------------------------------------------------
    // 1. Project matching
    // -----------------------------------------------------------------------
    for (const proj of projectTokens) {
      if (proj.tokens.length === 0) continue;

      // Separate into long tokens (≥5 chars) and short tokens (3-4 chars)
      const longTokens = proj.tokens.filter((t) => t.length >= 5);
      const shortTokens = proj.tokens.filter((t) => t.length >= 3 && t.length <= 4);

      let matchToken: string | null = null;

      // Rule 1: at least 1 long distinctive token
      for (const t of longTokens) {
        if (normText.includes(t)) {
          matchToken = t;
          break;
        }
      }

      // Rule 2: 2+ short distinctive tokens both appear
      if (!matchToken) {
        let shortMatched = 0;
        let firstShortToken: string | null = null;
        for (const t of shortTokens) {
          if (normText.includes(t)) {
            shortMatched++;
            if (!firstShortToken) firstShortToken = t;
          }
        }
        if (shortMatched >= 2) {
          matchToken = firstShortToken;
        }
      }

      if (matchToken) {
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
    // 2. Unmatched mention detection
    // -----------------------------------------------------------------------
    // Look for developer brand names followed by additional words.
    // Use original text for readability, but match case-insensitively.
    const lowerText = text.toLowerCase();
    for (const brand of DEVELOPER_BRANDS) {
      let searchFrom = 0;
      while (true) {
        const brandPos = lowerText.indexOf(brand, searchFrom);
        if (brandPos === -1) break;

        // Check that the brand is at a word boundary (not part of another word)
        const charBefore = brandPos > 0 ? lowerText[brandPos - 1] : " ";
        const charAfter = lowerText[brandPos + brand.length] ?? " ";
        const atWordBoundary =
          /[^a-z0-9]/.test(charBefore) && /[^a-z0-9]/.test(charAfter);

        if (atWordBoundary) {
          // Extract up to 3 additional words after the brand
          const afterBrand = text.slice(brandPos + brand.length).trimStart();
          const additionalWords = afterBrand.match(/^([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+){0,2})/);

          if (additionalWords && additionalWords[1].trim().length > 0) {
            const mentionText = text.slice(brandPos, brandPos + brand.length) + " " + additionalWords[1].trim();

            // Check if this matches a known project
            const mentionNorm = norm(mentionText);
            let matchesKnown = false;
            for (const p of projectTokens) {
              // Check if the mention's tokens substantially overlap with project tokens
              const mentionTokens = tokenize(mentionText);
              const longMatch = mentionTokens.filter((t) => t.length >= 5 && p.tokens.includes(t));
              if (longMatch.length >= 1) {
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
    // 3. Interest note detection
    // -----------------------------------------------------------------------
    // Look for config (BHK/BR/bedroom) + area + optional price
    const configRegex = /(\d+)\s*(BHK|BR|bedroom|bedrooms)/gi;
    let configMatch: RegExpExecArray | null;

    while ((configMatch = configRegex.exec(text)) !== null) {
      const configStr = `${configMatch[1]}${configMatch[2].toUpperCase().replace(/BEDROOMS?/i, "BR")}`;
      const matchPos = configMatch.index;

      // Look for area name within a window of ±120 chars around the config match
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

      // Capitalize area for the note
      const areaFormatted = foundArea
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      // Look for price pattern near the config
      let priceStr: string | null = null;
      const pricePatterns = [
        /AED\s*(\d+(?:\.\d+)?)\s*M/i,
        /AED\s*(\d+(?:\.\d+)?)\s*Cr/i,
        /(\d+(?:\.\d+)?)\s*Cr(?:ore)?/i,
        /(\d+(?:\.\d+)?)\s*Lakh/i,
        /AED\s*([\d,]+)/i,
      ];

      const windowForPrice = text.slice(windowStart, windowEnd);
      for (const priceRe of pricePatterns) {
        const priceMatch = priceRe.exec(windowForPrice);
        if (priceMatch) {
          // Format price string
          if (/AED\s*[\d.]+\s*M/i.test(priceMatch[0])) {
            priceStr = `AED ${priceMatch[1]}M`;
          } else if (/Cr/i.test(priceMatch[0])) {
            priceStr = `${priceMatch[1]} Cr`;
          } else if (/Lakh/i.test(priceMatch[0])) {
            priceStr = `${priceMatch[1]} Lakh`;
          } else if (/AED\s*[\d,]+/i.test(priceMatch[0])) {
            priceStr = `AED ${priceMatch[1]}`;
          }
          break;
        }
      }

      const noteText = priceStr
        ? `${configStr} ${areaFormatted} (${priceStr} budget)`
        : `${configStr} ${areaFormatted}`;

      // Deduplicate same config+area across sources
      const sig = `${configStr}|${areaFormatted}`;
      if (!seenInterestSigs.has(sig)) {
        seenInterestSigs.add(sig);
        interestNotes.push({
          noteText,
          sourceType: src.sourceType,
          sourceDate: src.sourceDate,
        });
      }
    }
  }

  return { projectMatches, unmatchedMentions, interestNotes };
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
    sources.push({
      text: lead.remarks,
      sourceType: "REMARK",
      sourceDate: now,
    });
  }

  if (lead.notesShort && lead.notesShort.trim()) {
    sources.push({
      text: lead.notesShort,
      sourceType: "NOTE",
      sourceDate: now,
    });
  }

  for (const note of lead.notes) {
    if (note.body && note.body.trim()) {
      sources.push({
        text: note.body,
        sourceType: "NOTE",
        sourceDate: note.createdAt,
      });
    }
  }

  for (const cl of lead.callLogs) {
    if (cl.notes && cl.notes.trim()) {
      sources.push({
        text: cl.notes,
        sourceType: "CALL_NOTE",
        sourceDate: cl.startedAt,
      });
    }
  }

  for (const wa of lead.waMessages) {
    if (wa.body && wa.body.trim()) {
      sources.push({
        text: wa.body,
        sourceType: "WA_MESSAGE",
        sourceDate: wa.receivedAt,
      });
    }
  }

  return sources;
}

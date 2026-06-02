-- Client classification (Lalit ask 2026-06-02)
-- Replaces the free-text `whoIsClient` cell with a 3-option dropdown
-- (Investor / End-user / Both), plus a 4th "Unclear" slot for leads the
-- agent hasn't qualified yet. `whoIsClient` itself is retained and
-- repurposed in the UI as "client situation / context notes" (the long
-- story behind the classification).
--
-- Purely additive: new enum + new nullable column on Lead. Existing data
-- is heuristically back-filled from `categorization`, `whoIsClient`, and
-- `tags` — anything that doesn't match a heuristic stays NULL and agents
-- will pick the value over time.

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('INVESTOR', 'END_USER', 'BOTH', 'UNCLEAR');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "clientType" "ClientType";

-- Heuristic back-fill — mirrored exactly in src/lib/leadIngest.ts for
-- newly-created leads. Order matters: BOTH first (most specific), then
-- INVESTOR, then END_USER. NULL stays NULL when nothing matches.

-- BOTH — explicit "investor + end-user" / "self-use + rental" mentions.
UPDATE "Lead" SET "clientType" = 'BOTH'
  WHERE "clientType" IS NULL AND (
    "categorization" ILIKE '%both%' OR
    "whoIsClient"     ILIKE '%both%' OR
    ("whoIsClient"   ILIKE '%investor%' AND "whoIsClient" ILIKE '%end%user%') OR
    ("whoIsClient"   ILIKE '%self%use%' AND "whoIsClient" ILIKE '%rent%')
  );

-- INVESTOR — yield / flip / rental / portfolio language.
UPDATE "Lead" SET "clientType" = 'INVESTOR'
  WHERE "clientType" IS NULL AND (
    "categorization" ILIKE '%investor%' OR
    "whoIsClient"     ILIKE '%investor%' OR
    "tags"            ILIKE '%investor%'
  );

-- END_USER — relocate / move-in / self-use / family residence language.
UPDATE "Lead" SET "clientType" = 'END_USER'
  WHERE "clientType" IS NULL AND (
    "categorization" ILIKE '%end%user%' OR
    "categorization" ILIKE '%end-user%' OR
    "categorization" ILIKE '%enduser%' OR
    "whoIsClient"     ILIKE '%end%user%' OR
    "whoIsClient"     ILIKE '%enduser%' OR
    "whoIsClient"     ILIKE '%relocate%' OR
    "whoIsClient"     ILIKE '%self%use%' OR
    "whoIsClient"     ILIKE '%move%in%'
  );

-- Anything still NULL is left for agents to set from the UI.

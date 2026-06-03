-- Add authorityPerson to Lead: free-text "who decides" field
-- Replaces the 4-value AuthorityLevel enum for the BANT A card.
ALTER TABLE "Lead" ADD COLUMN "authorityPerson" TEXT;

-- Add suggestion flag to LeadProject: auto-detected matches wait for
-- user acceptance before appearing in "Projects Discussed".
ALTER TABLE "LeadProject" ADD COLUMN "suggestion" BOOLEAN NOT NULL DEFAULT FALSE;

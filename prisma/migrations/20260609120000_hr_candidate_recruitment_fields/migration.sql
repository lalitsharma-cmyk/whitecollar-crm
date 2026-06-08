-- HR recruitment: add City, Position Applied For, and Real Estate Experience
-- to candidates. All nullable/additive — backward compatible with running code.
ALTER TABLE "HRCandidate" ADD COLUMN "city" TEXT;
ALTER TABLE "HRCandidate" ADD COLUMN "positionApplied" TEXT;
ALTER TABLE "HRCandidate" ADD COLUMN "realEstateExperience" TEXT;

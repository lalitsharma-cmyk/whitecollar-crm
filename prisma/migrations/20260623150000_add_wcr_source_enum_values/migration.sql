-- Add WCR-specific source values that existed in schema.prisma but were never
-- applied to the production Postgres enum (caused 22P02 "Something hiccuped" when
-- creating a lead with Source = WCR Event / Website / Landing Page).
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'WCR_WEBSITE';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'WCR_EVENT';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'LANDING_PAGE';

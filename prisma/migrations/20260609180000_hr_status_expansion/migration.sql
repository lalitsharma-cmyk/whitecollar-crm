-- HR CRM final spec: expand candidate status set. Additive enum values only.
-- (PostgreSQL 12+ allows ADD VALUE inside a migration transaction as long as the
--  new values are not used in the same transaction — they aren't here.)
ALTER TYPE "HRCandidateStatus" ADD VALUE IF NOT EXISTS 'INTERESTED';
ALTER TYPE "HRCandidateStatus" ADD VALUE IF NOT EXISTS 'INVALID_NUMBER';
ALTER TYPE "HRCandidateStatus" ADD VALUE IF NOT EXISTS 'F2F_INTERVIEW_SCHEDULED';
ALTER TYPE "HRCandidateStatus" ADD VALUE IF NOT EXISTS 'INTERVIEW_HELD';
ALTER TYPE "HRCandidateStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';
ALTER TYPE "HRCandidateStatus" ADD VALUE IF NOT EXISTS 'EXPECTED_JOINING';
ALTER TYPE "HRCandidateStatus" ADD VALUE IF NOT EXISTS 'FRESHER';
ALTER TYPE "HRCandidateStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

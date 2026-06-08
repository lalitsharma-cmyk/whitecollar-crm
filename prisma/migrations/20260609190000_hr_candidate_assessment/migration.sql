-- HR Candidate Detail: assessment fields (Candidate Fit + interview feedback + joining probability).
-- All nullable/additive — backward compatible.
ALTER TABLE "HRCandidate" ADD COLUMN "fitExperience" TEXT;
ALTER TABLE "HRCandidate" ADD COLUMN "fitCommunication" TEXT;
ALTER TABLE "HRCandidate" ADD COLUMN "fitStability" TEXT;
ALTER TABLE "HRCandidate" ADD COLUMN "fitSalary" TEXT;
ALTER TABLE "HRCandidate" ADD COLUMN "fitNotice" TEXT;
ALTER TABLE "HRCandidate" ADD COLUMN "interviewFeedback" TEXT;
ALTER TABLE "HRCandidate" ADD COLUMN "joiningProbability" TEXT;

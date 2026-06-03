-- Expand FundReadiness enum with MIS-sourced buyer-type labels
-- These map directly from the "Fund Readiness" column in agent MIS sheets.
-- Existing values (CASH_READY, BANK_APPROVED, FINANCING_NEEDED, NOT_DISCUSSED) are preserved.

ALTER TYPE "FundReadiness" ADD VALUE IF NOT EXISTS 'IMMEDIATE_BUYER';
ALTER TYPE "FundReadiness" ADD VALUE IF NOT EXISTS 'SHORT_TERM_BUYER';
ALTER TYPE "FundReadiness" ADD VALUE IF NOT EXISTS 'CONDITIONAL_BUYER';
ALTER TYPE "FundReadiness" ADD VALUE IF NOT EXISTS 'FINANCED_BUYER';
ALTER TYPE "FundReadiness" ADD VALUE IF NOT EXISTS 'FUTURE_BUYER';

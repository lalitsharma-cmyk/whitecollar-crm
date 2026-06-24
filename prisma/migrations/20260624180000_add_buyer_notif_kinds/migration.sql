-- Dedicated Buyer-Data lifecycle notification kinds (additive, idempotent).
-- Buyer assign / convert-to-lead / return-to-pool previously rode the generic
-- LEAD_ASSIGNED / SYSTEM kinds, so a manager could not tell a buyer event from a
-- lead event in the bell. These give buyer events their own kind. Severity stays
-- INFO (a buyer is not a hot lead — it must NOT trigger the new-lead alert).
-- PG17 supports ADD VALUE IF NOT EXISTS; runs in autocommit (no enclosing tx).
ALTER TYPE "NotifKind" ADD VALUE IF NOT EXISTS 'BUYER_ASSIGNED';
ALTER TYPE "NotifKind" ADD VALUE IF NOT EXISTS 'BUYER_CONVERTED';
ALTER TYPE "NotifKind" ADD VALUE IF NOT EXISTS 'BUYER_RETURNED';

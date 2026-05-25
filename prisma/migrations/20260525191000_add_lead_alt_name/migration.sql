-- Joint-buyer second name. MIS row "Customer = Soumya, Ayush Gupta" with two
-- phone numbers represents one client inquiry (family/friend buying together) —
-- importer now stores both names on one Lead: name + altName.

ALTER TABLE "Lead" ADD COLUMN "altName" TEXT;

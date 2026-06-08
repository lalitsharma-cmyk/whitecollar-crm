-- HR-team membership for admins who also work HR (appear in HR pickers, keep Sales access).
ALTER TABLE "User" ADD COLUMN "hrTeam" BOOLEAN NOT NULL DEFAULT false;

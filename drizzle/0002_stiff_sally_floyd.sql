-- Add the column nullable first
ALTER TABLE "session_ownership" ADD COLUMN "agent_type" text;
--> statement-breakpoint

-- Backfill all existing rows. Every existing session is a kommune session
-- because we only had one agent before this migration.
UPDATE "session_ownership"
SET "agent_type" = 'kommune-byggesak-saksbehandler'
WHERE "agent_type" IS NULL;
--> statement-breakpoint

-- Enforce NOT NULL now that every row has a value
ALTER TABLE "session_ownership" ALTER COLUMN "agent_type" SET NOT NULL;

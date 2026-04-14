ALTER TABLE "entitlements" DROP COLUMN "approved_at";--> statement-breakpoint
ALTER TABLE "entitlements" DROP COLUMN "approved_by";--> statement-breakpoint
ALTER TABLE "entitlements" DROP COLUMN "notes";--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
UPDATE "entitlements" SET status = 'trial',   trial_ends_at = now() + interval '14 days' WHERE status = 'pending';--> statement-breakpoint
UPDATE "entitlements" SET status = 'expired', trial_ends_at = now()                      WHERE status = 'suspended';

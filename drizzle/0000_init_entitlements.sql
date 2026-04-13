CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_org_id" text,
	"event" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"status" text NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_ownership" (
	"anthropic_session_id" text PRIMARY KEY NOT NULL,
	"clerk_org_id" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "audit_log_actor_org_created_idx" ON "audit_log" USING btree ("actor_org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_created_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_clerk_org_id_idx" ON "entitlements" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "session_ownership_org_created_idx" ON "session_ownership" USING btree ("clerk_org_id","created_at");
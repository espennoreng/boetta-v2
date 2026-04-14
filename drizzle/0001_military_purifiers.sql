CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"anthropic_session_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"original_name" text NOT NULL,
	"status" text NOT NULL,
	"anthropic_file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "attachments_session_idx" ON "attachments" USING btree ("anthropic_session_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_org_created_idx" ON "attachments" USING btree ("clerk_org_id","created_at");
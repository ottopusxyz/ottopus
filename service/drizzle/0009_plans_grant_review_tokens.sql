CREATE TABLE "review_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "plan_events" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "grant_id" uuid;--> statement-breakpoint
ALTER TABLE "review_tokens" ADD CONSTRAINT "review_tokens_plan_fk" FOREIGN KEY ("plan_id","plan_version") REFERENCES "public"."plans"("id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_tokens_plan_idx" ON "review_tokens" USING btree ("plan_id","plan_version");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plans_grant_idx" ON "plans" USING btree ("grant_id");
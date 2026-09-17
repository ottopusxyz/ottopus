CREATE TABLE "oauth_auth_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid,
	"scopes" text[] NOT NULL,
	"resource" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text DEFAULT 'S256' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"approved" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_auth_requests_pkce_s256" CHECK ("oauth_auth_requests"."code_challenge_method" = 'S256'),
	CONSTRAINT "oauth_auth_requests_decision_complete" CHECK (("oauth_auth_requests"."decided_at" is null and "oauth_auth_requests"."approved" is null)
          or ("oauth_auth_requests"."decided_at" is not null and "oauth_auth_requests"."approved" is not null
              and ("oauth_auth_requests"."approved" = false or "oauth_auth_requests"."user_id" is not null)))
);
--> statement-breakpoint
ALTER TABLE "oauth_auth_codes" ADD COLUMN "resource" text;--> statement-breakpoint
ALTER TABLE "oauth_auth_codes" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "client_uri" text;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "resource" text;--> statement-breakpoint
ALTER TABLE "oauth_auth_requests" ADD CONSTRAINT "oauth_auth_requests_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_auth_requests" ADD CONSTRAINT "oauth_auth_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_auth_requests_expires_idx" ON "oauth_auth_requests" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "oauth_auth_codes" ADD CONSTRAINT "oauth_auth_codes_request_id_oauth_auth_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."oauth_auth_requests"("id") ON DELETE cascade ON UPDATE no action;
-- Hand-written. Two layers of protection that drizzle cannot express.
--
-- Layer 1 — RLS, deny by default.
-- The browser holds no Supabase key, so nothing should ever reach these tables
-- as anon or authenticated. RLS with no policies denies everything, which makes
-- that the enforced default rather than a convention. If a client key ever does
-- leak, it reads nothing.
--
-- Layer 2 — triggers, for the append-only tables.
-- RLS does NOT constrain service_role, and the service connects as service_role.
-- So RLS alone cannot protect plan immutability from a bug in our own code.
-- Triggers fire for every role, superuser included. That is what actually holds
-- invariant 3: the review page is bound to an immutable planHash.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "linked_wallets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_auth_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "simulations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Force RLS on the table owner too, so the check is not skipped when migrations
-- or a pooler connect as the owning role.
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "simulations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Belt and braces: even with RLS off by accident, these roles hold no grants.
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "ottopus_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Insert a new row or a new plan version instead.';
END;
$$;--> statement-breakpoint

-- A plan version, once written, is what the review page hashed and the user saw.
CREATE TRIGGER "plans_append_only"
BEFORE UPDATE OR DELETE ON "plans"
FOR EACH ROW EXECUTE FUNCTION "ottopus_reject_mutation"();--> statement-breakpoint

-- Status lives here precisely so plans never need updating. Editing history
-- would let a blocked plan be quietly rewritten as confirmed.
CREATE TRIGGER "plan_events_append_only"
BEFORE UPDATE OR DELETE ON "plan_events"
FOR EACH ROW EXECUTE FUNCTION "ottopus_reject_mutation"();--> statement-breakpoint

-- Re-simulation writes a new row. Overwriting would erase the evidence that a
-- plan went stale between opening the page and signing.
CREATE TRIGGER "simulations_append_only"
BEFORE UPDATE OR DELETE ON "simulations"
FOR EACH ROW EXECUTE FUNCTION "ottopus_reject_mutation"();

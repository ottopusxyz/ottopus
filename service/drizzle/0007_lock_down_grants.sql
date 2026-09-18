-- Hand-written, following 0001. RLS is deny-by-default per table, and 0001's
-- blanket REVOKE could not cover a table that did not exist yet.
--
-- oauth_grants is the list Settings reads: which agents may act for whom, and
-- with what scopes. A leaked client key reading it would learn exactly that.

ALTER TABLE "oauth_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON TABLE "oauth_grants" FROM anon, authenticated;

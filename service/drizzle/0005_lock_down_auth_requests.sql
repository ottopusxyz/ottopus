-- Hand-written, following 0001. RLS is deny-by-default for every table, and a
-- new one is not covered by an earlier ALTER — so it has to be said here.
--
-- oauth_auth_requests holds a parked grant: the scopes an agent asked for, and
-- eventually who approved them. A leaked client key reading this table would
-- learn what an agent is about to be allowed to do, and could not be allowed to
-- write to it at all.

ALTER TABLE "oauth_auth_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON TABLE "oauth_auth_requests" FROM anon, authenticated;

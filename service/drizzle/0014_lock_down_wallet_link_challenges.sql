-- Hand-written, following 0001, 0007 and 0010. RLS is deny-by-default per
-- table, and 0001's blanket REVOKE could not cover a table that did not exist
-- yet.
--
-- A challenge is not a secret: what proves the wallet is the signature. But a
-- client key that could INSERT here could mint a challenge for another person's
-- account, and one that could UPDATE could un-consume a used one.

ALTER TABLE "wallet_link_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON TABLE "wallet_link_challenges" FROM anon, authenticated;

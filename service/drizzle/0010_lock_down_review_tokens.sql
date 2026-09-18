-- Hand-written, following 0001 and 0007. RLS is deny-by-default per table, and
-- 0001's blanket REVOKE could not cover a table that did not exist yet.
--
-- review_tokens holds only hashes, so a leak reads nothing usable — but a
-- client key that could INSERT here could mint itself a link to any plan.

ALTER TABLE "review_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON TABLE "review_tokens" FROM anon, authenticated;

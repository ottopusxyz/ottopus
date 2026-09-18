-- Hand-written. A data migration, not a schema one.
--
-- Tokens issued before oauth_grants existed have no grant behind them. They
-- still work — the resource server only refuses a grant that exists and was
-- revoked — but they would be invisible in Settings and unable to refresh,
-- which means the one thing a person can see about a connected agent is that
-- it is not there.
--
-- One grant per (person, agent) that still holds a live token. Dated from the
-- earliest token rather than now, so "connected since" stays true across the
-- migration.

INSERT INTO "oauth_grants" ("user_id", "client_id", "scopes", "resource", "granted_at")
SELECT DISTINCT ON (t."user_id", t."client_id")
       t."user_id",
       t."client_id",
       t."scopes",
       t."resource",
       (SELECT min(x."created_at") FROM "oauth_tokens" x
         WHERE x."user_id" = t."user_id" AND x."client_id" = t."client_id")
  FROM "oauth_tokens" t
 WHERE t."grant_id" IS NULL
   AND t."revoked_at" IS NULL
   AND t."expires_at" > now()
 -- Newest token wins for scopes and audience: it is the most recent thing the
 -- person actually approved.
 ORDER BY t."user_id", t."client_id", t."created_at" DESC
-- A live server may already have minted the grant this is trying to create:
-- the partial unique index allows one per (person, agent), and the UPDATE
-- below attaches the orphans to whichever row won.
ON CONFLICT DO NOTHING;--> statement-breakpoint

UPDATE "oauth_tokens" t
   SET "grant_id" = g."id"
  FROM "oauth_grants" g
 WHERE t."grant_id" IS NULL
   AND g."user_id" = t."user_id"
   AND g."client_id" = t."client_id"
   AND g."revoked_at" IS NULL;

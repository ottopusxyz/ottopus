-- Hand-written, in its own migration so regenerating the schema never
-- clobbers it.
--
-- Watch-only is permanent, and this is what makes it permanent.
--
-- A watch-only wallet is one nobody proved they control — a pasted address, or
-- a Safe, which cannot personal_sign at all. It must never become
-- execution-eligible through a later UPDATE, because the row carries no proof
-- and an UPDATE does not produce one. The supported path to signing with that
-- address is to unlink it and link it again through Privy, which writes a new
-- row carrying its own attestation.
--
-- A trigger rather than a CHECK: a CHECK sees only the incoming row and cannot
-- tell "inserted as a signer" from "quietly promoted to one". This needs the
-- old row to compare against.
--
-- A trigger rather than application code, for the same reason plans use one:
-- the service connects as service_role and bypasses RLS, so a bug in our own
-- code is the threat that is actually left, and triggers fire for every role.
CREATE OR REPLACE FUNCTION "ottopus_watch_only_is_permanent"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."is_watch_only" AND NOT NEW."is_watch_only" THEN
    RAISE EXCEPTION
      'wallet % is watch-only; it cannot be promoted to a signer', OLD."id"
      USING ERRCODE = 'restrict_violation',
            HINT = 'Unlink it and link it again with an ownership proof.';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "linked_wallets_watch_only_is_permanent"
BEFORE UPDATE ON "linked_wallets"
FOR EACH ROW EXECUTE FUNCTION "ottopus_watch_only_is_permanent"();

-- Display name, for the sign-in methods that carry one.
--
-- Nullable on purpose and permanently: Google gives a name, email and wallet do
-- not, and a wallet is a legitimate way to be a person here. It fills in later
-- if someone links a method that has one.
ALTER TABLE "users" ADD COLUMN "name" text;
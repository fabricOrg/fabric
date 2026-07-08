-- Customer dashboard becomes invite-only (parity with staff_users). resolve() no longer JIT-creates
-- a user/membership for any WorkOS-org identity; a user is provisioned by EMAIL at tenant creation
-- and the resolver only binds the WorkOS subject + activates the invite. For a user to exist before
-- first sign-in (no WorkOS `sub` yet), external_subject_id must be nullable (stamped on first login;
-- still UNIQUE — Postgres permits multiple NULLs), and email becomes the stable provisioning key.
-- The email UNIQUE add fails if duplicate emails already exist — that is itself a data bug to fix
-- before applying (JIT should never have created two rows for one human).
ALTER TABLE "users" ALTER COLUMN "external_subject_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
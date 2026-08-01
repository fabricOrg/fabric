-- Commercial catalog integrity (COM-011, ADR-0012 §8). Hand-written: privileges and cross-table
-- invariants are not expressible in the drizzle schema, and both are load-bearing here.
--
-- WHY A TRIGGER AND NOT A CHECK: the invariant spans tables ("this price book must be a token-mode
-- book"), which a CHECK constraint cannot reference. Service-level validation is not a substitute —
-- a migration, a fixture, or a future code path can bypass a service, and a workspace silently
-- pointed at a subscription rate book would resolve ZERO purchasable offers with nothing to see.

CREATE OR REPLACE FUNCTION assert_offer_catalog_is_token_book()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	book_mode text;
BEGIN
	SELECT mode INTO book_mode FROM price_books WHERE id = NEW.price_book_id;
	IF book_mode IS NULL THEN
		RAISE EXCEPTION 'price book % does not exist', NEW.price_book_id;
	END IF;
	IF book_mode <> 'token' THEN
		RAISE EXCEPTION
			'price book % is a % book; prepaid offers live in token-mode catalogs',
			NEW.price_book_id, book_mode;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER assert_offer_catalog_assignment_mode_trigger
BEFORE INSERT OR UPDATE OF price_book_id ON "offer_catalog_assignments"
FOR EACH ROW
EXECUTE FUNCTION assert_offer_catalog_is_token_book();--> statement-breakpoint

-- The same rule for the offers themselves. 0110 established the catalog FK but not its mode, so an
-- offer could be authored inside a pay-as-you-go rate book and never be reachable by a purchase.
CREATE TRIGGER assert_pricing_offer_catalog_mode_trigger
BEFORE INSERT OR UPDATE OF price_book_id ON "pricing_offers"
FOR EACH ROW
EXECUTE FUNCTION assert_offer_catalog_is_token_book();--> statement-breakpoint

-- Closing the back door: without this, the two triggers above are satisfiable at write time and then
-- falsified afterwards by editing the BOOK. `mode` is editable from the admin console's price-book
-- form, so this is a reachable path, not a theoretical one.
CREATE OR REPLACE FUNCTION protect_referenced_price_book_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.mode = OLD.mode THEN
		RETURN NEW;
	END IF;
	IF EXISTS (SELECT 1 FROM pricing_offers WHERE price_book_id = OLD.id) THEN
		RAISE EXCEPTION
			'price book % holds commercial offers; its mode cannot change', OLD.id;
	END IF;
	IF EXISTS (SELECT 1 FROM offer_catalog_assignments WHERE price_book_id = OLD.id) THEN
		RAISE EXCEPTION
			'price book % is assigned as a workspace catalog; its mode cannot change', OLD.id;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER protect_referenced_price_book_mode_trigger
BEFORE UPDATE OF mode ON "price_books"
FOR EACH ROW
EXECUTE FUNCTION protect_referenced_price_book_mode();--> statement-breakpoint

-- Privileges mirror 0110's posture for the offers themselves: this is control-plane commercial
-- configuration, so the tenant-facing role holds NOTHING on it. It is also why the assignment is a
-- table of its own rather than a column on `accounts` — app_runtime holds table-level UPDATE there,
-- and Postgres does not allow a column-level REVOKE to override a table-level grant, so a column
-- would have sat inside the tenant's own writable row.
--
-- Re-asserted by `db:assert security` on every deploy, because `prepareRoles()` re-grants broadly
-- before each migrate() and a journaled migration runs exactly once.
REVOKE ALL PRIVILEGES ON "offer_catalog_assignments" FROM PUBLIC, app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "offer_catalog_assignments" TO app_provisioner;

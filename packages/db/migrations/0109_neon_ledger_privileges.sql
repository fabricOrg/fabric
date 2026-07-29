-- Repair cloud databases bootstrapped before the append-only ledger revoke was reliably journaled.
-- Default table privileges can grant broad DML, so restate the invariant idempotently at the latest
-- migration boundary. Runtime may read and append ledger legs, but it must never rewrite history.
REVOKE UPDATE, DELETE ON ledger_entries FROM app_runtime;

-- flow_records was created by the typed-schema migration (0022). Grant the app_runtime role its
-- CRUD (same grant 0001 gives every table); the DEFAULT PRIVILEGES from 0001 don't reach a table
-- created by a later migration under a different connection, so make it explicit. RLS (0023) still
-- constrains every row to the tenant — this grant only lets the role touch the table at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON flow_records TO app_runtime;

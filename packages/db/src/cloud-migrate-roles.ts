import type { Sql } from "postgres";

/**
 * Role preparation for cloud migrations, split out of cloud-migrate.ts to hold the file-length guard.
 * Behaviour is unchanged.
 */

export interface RoleSpec {
  // app_provisioner: cross-tenant provisioning connection (BFF-guarded internal endpoints only).
  // NOBYPASSRLS like the others (RDS forbids BYPASSRLS) — its reach comes from permissive RLS
  // policies in migration 0013, not a role attribute. See docs/PI-3/PATH-TO-TESTING.md.
  name: "app_migrator" | "app_runtime" | "app_provisioner";
  password: string;
}

export interface RoleAttributes {
  canLogin: boolean;
  superuser: boolean;
  bypassRls: boolean;
  createDatabase: boolean;
  createRole: boolean;
  replication: boolean;
}

export async function quotedLiteral(sql: Sql, value: string): Promise<string> {
  const rows = await sql<{ quoted: string }[]>`
    SELECT quote_literal(${value}) AS quoted
  `;
  const quoted = rows[0]?.quoted;
  if (!quoted) {
    throw new Error("PostgreSQL did not return a quoted literal.");
  }
  return quoted;
}

export async function synchronizeRole(sql: Sql, spec: RoleSpec): Promise<void> {
  const roleRows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = ${spec.name}
    ) AS exists
  `;
  const password = await quotedLiteral(sql, spec.password);

  if (roleRows[0]?.exists) {
    // RDS administrators are not PostgreSQL superusers, so they cannot restate
    // NOSUPERUSER on an existing role even when the role is already non-super.
    try {
      await sql.unsafe(
        `ALTER ROLE ${spec.name} WITH LOGIN PASSWORD ${password}`,
      );
    } catch (error) {
      // Managed platforms (Neon, and others with a control plane) reserve role passwords to
      // themselves: a role created through their API cannot be altered by our admin connection,
      // which is not a true superuser. That is acceptable rather than fatal. What this function
      // actually needs to guarantee is a role that EXISTS, can log in, and is least-privileged —
      // asserted immediately below — plus a password matching the URL we hold, which is proven when
      // we connect using that very URL later in the migration. Rethrow anything that is not a
      // privilege error, so a genuine failure still stops the deploy.
      if ((error as { code?: string }).code !== "42501") throw error;
      console.warn(
        `[cloud-migrate] ${spec.name} is managed by the database platform; keeping its existing password and verifying by connection instead.`,
      );
    }
  } else {
    await sql.unsafe(
      `CREATE ROLE ${spec.name} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${password}`,
    );
  }

  const attributeRows = await sql<RoleAttributes[]>`
    SELECT
      rolcanlogin AS "canLogin",
      rolsuper AS superuser,
      rolbypassrls AS "bypassRls",
      rolcreatedb AS "createDatabase",
      rolcreaterole AS "createRole",
      rolreplication AS replication
    FROM pg_roles
    WHERE rolname = ${spec.name}
  `;
  assertLeastPrivilege(spec.name, attributeRows[0]);
}

export function assertLeastPrivilege(
  roleName: RoleSpec["name"],
  attributes: RoleAttributes | undefined,
): void {
  if (
    !attributes?.canLogin ||
    attributes.superuser ||
    attributes.bypassRls ||
    attributes.createDatabase ||
    attributes.createRole ||
    attributes.replication
  ) {
    throw new Error(`${roleName} failed its least-privilege verification.`);
  }
}

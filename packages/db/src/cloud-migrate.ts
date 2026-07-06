import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";

interface MigrationEnvironment {
  adminUrl: string;
  ownerUrl: string;
  runtimeUrl: string;
  provisionerUrl: string;
}

interface RoleSpec {
  // app_provisioner: cross-tenant provisioning connection (BFF-guarded internal endpoints only).
  // NOBYPASSRLS like the others (RDS forbids BYPASSRLS) — its reach comes from permissive RLS
  // policies in migration 0013, not a role attribute. See docs/PI-3/PATH-TO-TESTING.md.
  name: "app_migrator" | "app_runtime" | "app_provisioner";
  password: string;
}

interface RoleAttributes {
  canLogin: boolean;
  superuser: boolean;
  bypassRls: boolean;
  createDatabase: boolean;
  createRole: boolean;
  replication: boolean;
}

function requireUrl(name: keyof NodeJS.ProcessEnv): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readEnvironment(): MigrationEnvironment {
  return {
    adminUrl: requireUrl("DATABASE_URL_ADMIN"),
    ownerUrl: requireUrl("DATABASE_URL_OWNER"),
    runtimeUrl: requireUrl("DATABASE_URL_APP"),
    provisionerUrl: requireUrl("DATABASE_URL_PROVISIONER"),
  };
}

async function quotedLiteral(sql: Sql, value: string): Promise<string> {
  const rows = await sql<{ quoted: string }[]>`
    SELECT quote_literal(${value}) AS quoted
  `;
  const quoted = rows[0]?.quoted;
  if (!quoted) {
    throw new Error("PostgreSQL did not return a quoted literal.");
  }
  return quoted;
}

async function quotedIdentifier(sql: Sql, value: string): Promise<string> {
  const rows = await sql<{ quoted: string }[]>`
    SELECT quote_ident(${value}) AS quoted
  `;
  const quoted = rows[0]?.quoted;
  if (!quoted) {
    throw new Error("PostgreSQL did not return a quoted identifier.");
  }
  return quoted;
}

async function synchronizeRole(sql: Sql, spec: RoleSpec): Promise<void> {
  const roleRows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = ${spec.name}
    ) AS exists
  `;
  const password = await quotedLiteral(sql, spec.password);

  if (roleRows[0]?.exists) {
    // RDS administrators are not PostgreSQL superusers, so they cannot restate
    // NOSUPERUSER on an existing role even when the role is already non-super.
    await sql.unsafe(`ALTER ROLE ${spec.name} WITH LOGIN PASSWORD ${password}`);
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

async function prepareRoles(environment: MigrationEnvironment): Promise<void> {
  const admin = postgres(environment.adminUrl, { max: 1 });
  try {
    const ownerPassword = decodeURIComponent(
      new URL(environment.ownerUrl).password,
    );
    const runtimePassword = decodeURIComponent(
      new URL(environment.runtimeUrl).password,
    );
    const provisionerPassword = decodeURIComponent(
      new URL(environment.provisionerUrl).password,
    );
    if (!ownerPassword || !runtimePassword || !provisionerPassword) {
      throw new Error(
        "Owner, runtime, and provisioner database URLs must contain passwords.",
      );
    }

    await synchronizeRole(admin, {
      name: "app_migrator",
      password: ownerPassword,
    });
    await synchronizeRole(admin, {
      name: "app_runtime",
      password: runtimePassword,
    });
    await synchronizeRole(admin, {
      name: "app_provisioner",
      password: provisionerPassword,
    });

    const adminIdentity = await admin<{ currentUser: string }[]>`
      SELECT current_user AS "currentUser"
    `;
    const adminUser = adminIdentity[0]?.currentUser;
    const databaseName = new URL(environment.adminUrl).pathname.replace(
      /^\//,
      "",
    );
    if (!adminUser || !databaseName) {
      throw new Error("Unable to resolve the admin user or database name.");
    }

    const quotedAdmin = await quotedIdentifier(admin, adminUser);
    const quotedDatabase = await quotedIdentifier(admin, databaseName);
    await admin.unsafe(`GRANT app_migrator TO ${quotedAdmin}`);
    await admin.unsafe(
      `ALTER DATABASE ${quotedDatabase} OWNER TO app_migrator`,
    );
    await admin.unsafe("ALTER SCHEMA public OWNER TO app_migrator");
    await admin.unsafe("GRANT ALL ON SCHEMA public TO app_migrator");

    // app_provisioner (BYPASSRLS): DML on every table the owner creates — now and future. Default
    // privileges are set BEFORE migrate runs, so tables created this run inherit the grant; the
    // ON ALL TABLES grants cover any that already existed. app_provisioner owns nothing.
    await admin.unsafe("GRANT USAGE ON SCHEMA public TO app_provisioner");
    await admin.unsafe(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_provisioner",
    );
    await admin.unsafe(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_provisioner",
    );
    await admin.unsafe(
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_provisioner",
    );
    await admin.unsafe(
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_provisioner",
    );
  } finally {
    await admin.end();
  }
}

/**
 * app_provisioner is least-privilege like app_runtime (NOBYPASSRLS, no superuser) — its cross-tenant
 * reach comes from the permissive RLS policies in migration 0013, not a role attribute. Here we only
 * assert the attributes + connectivity; the policies' effect is exercised end-to-end by the API's
 * identity-resolve path and the staff-resolver integration tests.
 */
async function verifyProvisionerRole(provisionerUrl: string): Promise<void> {
  const provisioner = postgres(provisionerUrl, { max: 1 });
  try {
    const rows = await provisioner<
      { currentUser: string; superuser: boolean; bypassRls: boolean }[]
    >`
      SELECT
        current_user AS "currentUser",
        rolsuper AS superuser,
        rolbypassrls AS "bypassRls"
      FROM pg_roles
      WHERE rolname = current_user
    `;
    const role = rows[0];
    if (
      role?.currentUser !== "app_provisioner" ||
      role.superuser ||
      role.bypassRls
    ) {
      throw new Error(
        "app_provisioner failed its least-privilege verification.",
      );
    }
    await provisioner`SELECT 1`;
  } finally {
    await provisioner.end();
  }
}

async function verifyRuntimeRole(runtimeUrl: string): Promise<void> {
  const runtime = postgres(runtimeUrl, { max: 1 });
  try {
    const rows = await runtime<
      { currentUser: string; superuser: boolean; bypassRls: boolean }[]
    >`
      SELECT
        current_user AS "currentUser",
        rolsuper AS superuser,
        rolbypassrls AS "bypassRls"
      FROM pg_roles
      WHERE rolname = current_user
    `;
    const role = rows[0];
    if (
      role?.currentUser !== "app_runtime" ||
      role.superuser ||
      role.bypassRls
    ) {
      throw new Error("app_runtime failed its least-privilege verification.");
    }
    await runtime`SELECT 1`;
  } finally {
    await runtime.end();
  }
}

export async function runCloudMigrations(
  environment = readEnvironment(),
): Promise<void> {
  await prepareRoles(environment);

  const owner = postgres(environment.ownerUrl, { max: 1 });
  try {
    const migrationsFolder = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "migrations",
    );
    await migrate(drizzle(owner), { migrationsFolder });
  } finally {
    await owner.end();
  }

  await verifyRuntimeRole(environment.runtimeUrl);
  await verifyProvisionerRole(environment.provisionerUrl);
}

export function isEntrypoint(
  moduleUrl: string,
  invokedPath = process.argv[1],
): boolean {
  if (!invokedPath) return false;
  try {
    return (
      realpathSync(resolve(invokedPath)) ===
      realpathSync(fileURLToPath(moduleUrl))
    );
  } catch {
    return false;
  }
}

if (isEntrypoint(import.meta.url)) {
  console.log("Starting cloud database migrations.");
  runCloudMigrations()
    .then(() => {
      console.log("Cloud database migrations and role verification passed.");
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";

interface MigrationEnvironment {
  adminUrl: string;
  ownerUrl: string;
  runtimeUrl: string;
}

interface RoleSpec {
  name: "app_migrator" | "app_runtime";
  password: string;
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
  const attributes =
    "LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION";

  if (roleRows[0]?.exists) {
    await sql.unsafe(
      `ALTER ROLE ${spec.name} WITH ${attributes} PASSWORD ${password}`,
    );
    return;
  }

  await sql.unsafe(
    `CREATE ROLE ${spec.name} WITH ${attributes} PASSWORD ${password}`,
  );
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
    if (!ownerPassword || !runtimePassword) {
      throw new Error(
        "Owner and runtime database URLs must contain passwords.",
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
  } finally {
    await admin.end();
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
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCloudMigrations()
    .then(() => {
      console.log("Cloud database migrations and role verification passed.");
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}

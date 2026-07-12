import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL_SUPER;
const tenantId = process.argv[2];

if (!databaseUrl) throw new Error("DATABASE_URL_SUPER is required.");
if (!tenantId) throw new Error("Usage: audit-tenant-ownership.ts <tenant-id>");

async function main(url: string, targetTenantId: string) {
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql<
      Array<{
        email: string;
        role: string;
        developer_access: boolean;
        status: string;
      }>
    >`
      SELECT u.email, m.role, m.developer_access, m.status
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${targetTenantId}
      ORDER BY m.role, u.email
    `;
    console.log(
      JSON.stringify({ tenantId: targetTenantId, memberships: rows }, null, 2),
    );
  } finally {
    await sql.end();
  }
}

void main(databaseUrl, tenantId);

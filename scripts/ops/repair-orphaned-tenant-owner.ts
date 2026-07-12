import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL_SUPER;
const tenantId = process.argv[2];
const ownerEmail = process.argv[3]?.trim().toLowerCase();

if (!databaseUrl) throw new Error("DATABASE_URL_SUPER is required.");
if (!tenantId || !ownerEmail) {
  throw new Error(
    "Usage: repair-orphaned-tenant-owner.ts <tenant-id> <owner-email>",
  );
}

async function main(url: string, targetTenantId: string, targetEmail: string) {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      const [existingOwner] = await tx<Array<{ email: string }>>`
        SELECT u.email
        FROM memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ${targetTenantId}
          AND m.role = 'owner'
          AND m.status = 'active'
        LIMIT 1
        FOR UPDATE
      `;
      if (existingOwner) {
        throw new Error(
          `Tenant already has active owner ${existingOwner.email}.`,
        );
      }

      const [updated] = await tx<Array<{ email: string }>>`
        UPDATE memberships m
        SET role = 'owner', status = 'active', updated_at = NOW()
        FROM users u
        WHERE m.user_id = u.id
          AND m.tenant_id = ${targetTenantId}
          AND LOWER(u.email) = ${targetEmail}
        RETURNING u.email
      `;
      if (!updated) {
        throw new Error("Target user has no membership in this tenant.");
      }
      console.log(`Repaired tenant owner: ${updated.email}`);
    });
  } finally {
    await sql.end();
  }
}

void main(databaseUrl, tenantId, ownerEmail);

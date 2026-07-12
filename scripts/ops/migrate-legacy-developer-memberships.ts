import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL_SUPER;
const preserveLegacy = process.argv.includes("--preserve-legacy");
if (!databaseUrl) throw new Error("DATABASE_URL_SUPER is required.");

async function main(url: string) {
  const sql = postgres(url, { max: 1 });
  try {
    const rows = preserveLegacy
      ? await sql<Array<{ email: string }>>`
          UPDATE memberships m
          SET role = 'developer', developer_access = true, updated_at = NOW()
          FROM users u
          WHERE m.user_id = u.id
            AND m.role = 'member'
            AND m.developer_access = true
          RETURNING u.email
        `
      : await sql<Array<{ email: string }>>`
          UPDATE memberships m
          SET role = 'member', developer_access = true, updated_at = NOW()
          FROM users u
          WHERE m.user_id = u.id AND m.role = 'developer'
          RETURNING u.email
        `;
    console.log(
      `${preserveLegacy ? "Preserved" : "Migrated"} ${rows.length} developer membership(s).`,
    );
  } finally {
    await sql.end();
  }
}

void main(databaseUrl);

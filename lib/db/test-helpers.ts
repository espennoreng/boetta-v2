import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export async function createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const client = new PGlite({ extensions: { pgcrypto } });
  await client.waitReady;
  const db = drizzle(client, { schema });

  // Enable pgcrypto for gen_random_uuid() used in migrations
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // Apply all generated migrations in order
  const migrationsDir = join(process.cwd(), "drizzle");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const rawSql = readFileSync(join(migrationsDir, file), "utf8");
    // drizzle-kit emits statement-breakpoint comments; split on them
    const statements = rawSql
      .split(/--\s*>\s*statement-breakpoint/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }
  }

  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}

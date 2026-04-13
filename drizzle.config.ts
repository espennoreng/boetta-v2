import { defineConfig } from "drizzle-kit";
import { readFileSync, existsSync } from "node:fs";

// drizzle-kit runs via tsx/esbuild and doesn't auto-load .env.local.
// Manually parse it here so `bun run db:migrate` and `db:studio` work.
if (existsSync(".env.local") && !process.env.DATABASE_URL) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
  casing: "snake_case",
});

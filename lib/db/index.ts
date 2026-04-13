import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "./schema";

if (typeof window === "undefined" && !neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = ws;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

export const db = drizzle(pool, { schema });
export * from "./schema";

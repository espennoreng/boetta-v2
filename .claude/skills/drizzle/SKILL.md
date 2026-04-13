---
name: drizzle
description: Use when working with Drizzle ORM — declaring schemas, writing type-safe SQL queries, defining relations, running transactions, or managing migrations with drizzle-kit. Applies to PostgreSQL, MySQL, SQLite, and serverless drivers (Neon, PlanetScale, D1, libsql). Triggers on imports from `drizzle-orm`, `drizzle-orm/*`, or `drizzle-kit`, and on files like `drizzle.config.ts`, `schema.ts`, or any migrations folder.
---

# Drizzle ORM

A headless, type-safe TypeScript ORM that generates SQL you can read. Two query APIs: SQL-like (`db.select().from()...`) and relational (`db.query.users.findMany({ with: ... })`). Zero runtime magic — schema is plain TS, queries compile to SQL you control.

**Official docs:** https://orm.drizzle.team/docs/overview

## When to Use

- Declaring tables/columns/indexes in TypeScript
- Writing CRUD, joins, or aggregations against a SQL database
- Fetching nested relational data without hand-rolled joins
- Grouping writes in a transaction or batch
- Generating, applying, or introspecting migrations via `drizzle-kit`
- Connecting to Postgres/MySQL/SQLite (incl. Neon, PlanetScale, Supabase, D1, libsql)

**Don't use for:** MongoDB/NoSQL (Drizzle is SQL-only), or when you need a heavy active-record pattern with hooks/lifecycles (Drizzle is intentionally thin).

## Dialect Cheat Sheet

| Dialect    | Table         | Core import              | Driver examples                                              |
| ---------- | ------------- | ------------------------ | ------------------------------------------------------------ |
| PostgreSQL | `pgTable`     | `drizzle-orm/pg-core`    | `node-postgres`, `postgres-js`, `neon-http`, `neon-serverless` |
| MySQL      | `mysqlTable`  | `drizzle-orm/mysql-core` | `mysql2`, `planetscale-serverless`                           |
| SQLite     | `sqliteTable` | `drizzle-orm/sqlite-core`| `better-sqlite3`, `libsql`, `d1` (Cloudflare)                |

Examples below are PostgreSQL unless noted — same shapes apply to the other dialects.

## 1. Connect

```ts
// node-postgres (simplest)
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export const db = drizzle(process.env.DATABASE_URL!, { schema });
```

```ts
// postgres.js
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
```

```ts
// Neon HTTP (edge / serverless)
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
```

Pass `{ schema }` to enable the relational query builder (`db.query.*`).

## 2. Declare Schema

```ts
// src/db/schema.ts
import {
  pgTable, serial, text, varchar, integer, boolean, timestamp,
  jsonb, uuid, numeric, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["admin", "member", "guest"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 256 }).notNull(),
    name: text("name"),
    role: roleEnum("role").notNull().default("member"),
    metadata: jsonb("metadata").$type<{ theme?: string }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    roleIdx: index("users_role_idx").on(t.role),
  }),
);

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  published: boolean("published").notNull().default(false),
  views: integer("views").notNull().default(0),
});
```

**Inference helpers** (use these instead of redeclaring types):

```ts
type User = typeof users.$inferSelect;   // row shape
type NewUser = typeof users.$inferInsert; // insert shape (nullables/defaults optional)
```

### Common column types (Postgres)

`serial`, `bigserial`, `integer`, `bigint`, `numeric({ precision, scale, mode: "number" | "bigint" })`, `real`, `doublePrecision`, `text`, `varchar({ length })`, `char`, `boolean`, `timestamp({ withTimezone, mode: "date" | "string" })`, `date`, `uuid`, `json`, `jsonb`, `pgEnum`, arrays via `.array()`, `vector({ dimensions })` (pgvector).

MySQL: `int`, `varchar`, `datetime`, `mysqlEnum`. SQLite: `integer`, `text`, `real`, `blob` (use `{ mode: "boolean" | "timestamp" | "json" }` to map).

### Constraints & indexes

- `.notNull()`, `.default(value | sql\`…\`)`, `.unique()`, `.primaryKey()`
- `.references(() => other.col, { onDelete: "cascade" | "set null" | "restrict", onUpdate: ... })`
- Table-level: `primaryKey({ columns: [...] })` for composite PKs; `uniqueIndex`, `index`, `foreignKey` inside the `(t) => ({...})` builder.

## 3. Relations (for relational queries)

```ts
// src/db/relations.ts
import { relations } from "drizzle-orm";
import { users, posts } from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}));
```

Export relations from the same `schema` barrel you pass to `drizzle({ schema })`.

## 4. Query: SQL-like API

```ts
import { and, or, eq, gt, lt, gte, ilike, inArray, desc, asc, sql } from "drizzle-orm";

// select
const rows = await db.select().from(users).where(eq(users.role, "admin"));

// partial select + filters + pagination
const page = await db
  .select({ id: users.id, email: users.email })
  .from(users)
  .where(and(eq(users.role, "member"), ilike(users.email, "%@acme.com")))
  .orderBy(desc(users.createdAt))
  .limit(20)
  .offset(40);

// joins
const withAuthor = await db
  .select({ post: posts, authorName: users.name })
  .from(posts)
  .innerJoin(users, eq(users.id, posts.authorId))
  .where(eq(posts.published, true));

// aggregates
const counts = await db
  .select({ role: users.role, n: sql<number>`count(*)::int` })
  .from(users)
  .groupBy(users.role);

// insert + returning
const [created] = await db
  .insert(users)
  .values({ email: "a@b.com", name: "A" })
  .returning();

// update
await db.update(users).set({ name: "Renamed" }).where(eq(users.id, created.id));

// delete
await db.delete(posts).where(lt(posts.views, 10));
```

### Upsert

```ts
// Postgres / SQLite
await db.insert(users)
  .values({ email: "a@b.com", name: "A" })
  .onConflictDoUpdate({ target: users.email, set: { name: "A" } });

await db.insert(users)
  .values({ email: "a@b.com", name: "A" })
  .onConflictDoNothing({ target: users.email });

// MySQL
await db.insert(users)
  .values({ email: "a@b.com", name: "A" })
  .onDuplicateKeyUpdate({ set: { name: "A" } });
```

Use `sql\`excluded.col\`` inside `.set` for bulk upserts.

### Operators

`eq, ne, gt, gte, lt, lte, isNull, isNotNull, inArray, notInArray, like, ilike, notLike, between, arrayContains, arrayOverlaps, and, or, not`. Raw SQL via `sql\`…\`` with tagged params: ``sql`${users.id} = ${id}` ``.

## 5. Query: Relational API

Requires `schema` + `relations`.

```ts
const feed = await db.query.users.findMany({
  columns: { id: true, name: true },
  with: {
    posts: {
      where: (p, { eq }) => eq(p.published, true),
      orderBy: (p, { desc }) => [desc(p.views)],
      limit: 5,
    },
  },
  where: (u, { eq }) => eq(u.role, "member"),
});

const one = await db.query.users.findFirst({
  where: (u, { eq }) => eq(u.id, id),
  with: { posts: true },
});
```

Rule of thumb: use relational for nested reads, SQL-like for writes/aggregates/complex joins.

## 6. Transactions

```ts
await db.transaction(async (tx) => {
  await tx.update(accounts)
    .set({ balance: sql`${accounts.balance} - 100` })
    .where(eq(accounts.userId, 1));

  const [a] = await tx.select().from(accounts).where(eq(accounts.userId, 1));
  if (a.balance < 0) tx.rollback(); // throws, aborts tx
});

// Postgres isolation / access mode
await db.transaction(async (tx) => { /* ... */ }, {
  isolationLevel: "serializable",
  accessMode: "read write",
});
```

Nested `tx.transaction(...)` creates savepoints.

## 7. Batch (serverless: libSQL / Neon / D1)

```ts
const [a, b, c] = await db.batch([
  db.insert(users).values({ email: "x@y.com" }).returning({ id: users.id }),
  db.update(users).set({ name: "x" }).where(eq(users.id, 1)),
  db.query.users.findMany({}),
]);
```

## 8. Migrations with drizzle-kit

```ts
// drizzle.config.ts (project root)
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",          // | "mysql" | "sqlite" | "turso" | "singlestore"
  schema: "./src/db/schema.ts",   // or glob: "./src/db/schema/*.ts"
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // optional:
  // casing: "snake_case",
  // migrations: { table: "journal", schema: "drizzle" },
  // schemaFilter: ["public"],
});
```

| Command                  | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `drizzle-kit generate`   | Diff schema → emit SQL migration files in `out/`                 |
| `drizzle-kit migrate`    | Apply pending migrations to the DB                               |
| `drizzle-kit push`       | Sync schema directly, no files (great for dev / prototypes)      |
| `drizzle-kit pull`       | Introspect existing DB → generate `schema.ts` (DB-first)         |
| `drizzle-kit studio`     | Launch local GUI at https://local.drizzle.studio                 |
| `drizzle-kit check`      | Detect conflicts across migration files                          |
| `drizzle-kit up`         | Upgrade snapshot format after Drizzle upgrades                   |

**Apply in app code (prod pattern):**

```ts
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db";

await migrate(db, { migrationsFolder: "./drizzle" });
```

Each dialect/driver has its own `/migrator` path — match it to your `drizzle()` import.

### generate vs push — which to use?

- **`generate` + `migrate`** — production workflow. SQL files are reviewable, versioned, deterministic.
- **`push`** — dev/prototype. Skips files, mutates DB to match schema. Never on shared/prod DBs.

## Quick Reference

| Task                            | How                                                                 |
| ------------------------------- | ------------------------------------------------------------------- |
| Infer row type                  | `typeof table.$inferSelect` / `$inferInsert`                        |
| Raw SQL fragment                | `` sql`lower(${users.email}) = ${email.toLowerCase()}` ``           |
| Untyped raw query               | `db.execute(sql`select 1`)`                                         |
| Return inserted rows            | `.returning()` (Postgres/SQLite); MySQL: select after insert        |
| Composite PK                    | Table builder: `pk: primaryKey({ columns: [t.a, t.b] })`            |
| Default now()                   | `.default(sql\`now()\`)` or `.defaultNow()`                         |
| UUID v4 default                 | `uuid().defaultRandom().primaryKey()`                               |
| Nested relation filter          | `with: { posts: { where: (p, { eq }) => eq(p.published, true) } }`  |
| Prepared statement              | `const q = db.select()...prepare("name"); await q.execute({...});` |

## Common Mistakes

- **Forgetting `{ schema }` on `drizzle()`** → `db.query.*` is `undefined`. Always pass your schema barrel.
- **Relations not exported from schema barrel** → relational queries can't find them. Re-export `*Relations` alongside tables.
- **Using `push` against prod** → can silently drop columns. Use `generate` + `migrate`.
- **`serial`/`integer` mismatch on FK** → foreign keys must match the referenced column's exact type (`serial` references `integer`, not `serial`).
- **`timestamp` without `mode`** → returns `string`, not `Date`. Use `timestamp("...", { mode: "date" })` for JS `Date` objects.
- **`sql\`...\`` with string interpolation** → use tagged params (`${value}`), never string concat — Drizzle parameterizes `${}` but not `sql.raw(\`${value}\`)`.
- **Mixing query builder with Promise handlers mid-chain** → the builder is thenable; `.then()`/`await` executes it. Don't `await` before adding `.where()`.
- **Enum changes need migrations** → `pgEnum` values can't be edited in place; generate a migration or use `ALTER TYPE`.
- **`onConflictDoUpdate` without `target`** → Postgres requires a conflict target (unique constraint or index).

## Project Pattern (recommended layout)

```
src/db/
  index.ts        # drizzle() instance, exports `db`
  schema.ts       # tables + pgEnum + relations (or schema/*.ts barrel)
drizzle/          # generated SQL migrations (committed)
drizzle.config.ts # drizzle-kit config
```

Scripts in `package.json`:

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate":  "drizzle-kit migrate",
    "db:push":     "drizzle-kit push",
    "db:studio":   "drizzle-kit studio"
  }
}
```

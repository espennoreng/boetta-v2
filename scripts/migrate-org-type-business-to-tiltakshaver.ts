import { clerkClient } from "@clerk/nextjs/server";
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY not set");
  }

  const client = await clerkClient();

  let updated = 0;
  let scanned = 0;
  let offset = 0;
  const limit = 100;

  while (true) {
    const { data: orgs } = await client.organizations.getOrganizationList({
      limit,
      offset,
    });
    if (orgs.length === 0) break;

    for (const org of orgs) {
      scanned++;
      const orgType = (org.publicMetadata as Record<string, unknown>)?.orgType;
      if (orgType === "business") {
        await client.organizations.updateOrganization(org.id, {
          publicMetadata: {
            ...(org.publicMetadata ?? {}),
            orgType: "tiltakshaver",
          },
        });
        console.log(`  migrated: ${org.id} (${org.name})`);
        updated++;
      }
    }
    offset += orgs.length;
  }

  console.log(`\nScanned ${scanned} orgs; migrated ${updated} business → tiltakshaver.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

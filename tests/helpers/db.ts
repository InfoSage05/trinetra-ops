import { prisma } from "@/lib/db";

export function assertTestDatabase(url = process.env.DATABASE_URL): void {
  const dbName = url ? new URL(url).pathname.replace("/", "") : "";
  if (!dbName.includes("test")) {
    throw new Error(`Refusing to reset database "${dbName}": tests may only touch a database whose name contains "test"`);
  }
}

/** Empties every application table. Table list is discovered, so it never drifts from the schema. */
export async function resetDb(): Promise<void> {
  assertTestDatabase();
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "./pool.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export async function runMigrations(): Promise<string[]> {
  const pool = getPool();
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations " +
      "(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const { rows } = await pool.query<{ version: string }>("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.version));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      ran.push(version);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return ran;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then((ran) => {
      console.log(ran.length ? `Applied: ${ran.join(", ")}` : "No pending migrations");
    })
    .finally(() => closePool());
}

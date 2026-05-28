import { Pool, type PoolConfig } from "pg";

let pool: Pool | undefined;

export function databasePoolConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  if (env.DATABASE_URL) {
    return { connectionString: env.DATABASE_URL };
  }

  const host = env.DATABASE_HOST;
  const database = env.DATABASE_NAME;
  const user = env.DATABASE_USER;
  const password = env.DATABASE_PASSWORD;
  if (!host || !database || !user || !password) {
    throw new Error(
      "DATABASE_URL or DATABASE_HOST, DATABASE_NAME, DATABASE_USER, and DATABASE_PASSWORD must be set",
    );
  }

  const port = env.DATABASE_PORT ? Number(env.DATABASE_PORT) : 5432;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("DATABASE_PORT must be a positive integer");
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl:
      env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
        : undefined,
  };
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(databasePoolConfigFromEnv());
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

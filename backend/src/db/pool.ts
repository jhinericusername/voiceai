import { Pool, type PoolConfig } from "pg";

let pool: Pool | undefined;
let weavePool: Pool | undefined;

export function databasePoolConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return databasePoolConfigFromEnvPrefix("DATABASE", env);
}

export function databasePoolConfigFromEnvPrefix(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  const urlKey = `${prefix}_URL`;
  const hostKey = `${prefix}_HOST`;
  const portKey = `${prefix}_PORT`;
  const databaseKey = `${prefix}_NAME`;
  const userKey = `${prefix}_USER`;
  const passwordKey = `${prefix}_PASSWORD`;
  const sslKey = `${prefix}_SSL`;
  const sslRejectUnauthorizedKey = `${prefix}_SSL_REJECT_UNAUTHORIZED`;

  if (env[urlKey]) {
    return { connectionString: env[urlKey] };
  }

  const host = env[hostKey];
  const database = env[databaseKey];
  const user = env[userKey];
  const password = env[passwordKey];
  if (!host || !database || !user || !password) {
    throw new Error(
      `${urlKey} or ${hostKey}, ${databaseKey}, ${userKey}, and ${passwordKey} must be set`,
    );
  }

  const port = env[portKey] ? Number(env[portKey]) : 5432;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${portKey} must be a positive integer`);
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl:
      env[sslKey] === "true"
        ? { rejectUnauthorized: env[sslRejectUnauthorizedKey] !== "false" }
        : undefined,
  };
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(databasePoolConfigFromEnv());
  }
  return pool;
}

export function getWeavePool(): Pool {
  if (!weavePool) {
    weavePool = new Pool(databasePoolConfigFromEnvPrefix("WEAVE_DATABASE"));
  }
  return weavePool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export async function closeWeavePool(): Promise<void> {
  if (weavePool) {
    await weavePool.end();
    weavePool = undefined;
  }
}

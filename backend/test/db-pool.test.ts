import { describe, expect, it } from "vitest";
import { databasePoolConfigFromEnv } from "../src/db/pool.js";

describe("databasePoolConfigFromEnv", () => {
  it("prefers DATABASE_URL when present", () => {
    expect(
      databasePoolConfigFromEnv({
        DATABASE_URL: "postgresql://user:password@localhost:5432/puddle",
      }).connectionString,
    ).toBe("postgresql://user:password@localhost:5432/puddle");
  });

  it("builds a pg config from RDS-style split env vars", () => {
    expect(
      databasePoolConfigFromEnv({
        DATABASE_HOST: "db.internal",
        DATABASE_PORT: "5433",
        DATABASE_NAME: "puddle",
        DATABASE_USER: "puddle_app",
        DATABASE_PASSWORD: "secret",
        DATABASE_SSL: "true",
      }),
    ).toMatchObject({
      host: "db.internal",
      port: 5433,
      database: "puddle",
      user: "puddle_app",
      password: "secret",
      ssl: { rejectUnauthorized: true },
    });
  });

  it("can require SSL without certificate verification for private RDS", () => {
    expect(
      databasePoolConfigFromEnv({
        DATABASE_HOST: "db.internal",
        DATABASE_NAME: "puddle",
        DATABASE_USER: "puddle_app",
        DATABASE_PASSWORD: "secret",
        DATABASE_SSL: "true",
        DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
      }),
    ).toMatchObject({
      ssl: { rejectUnauthorized: false },
    });
  });

  it("throws when no usable database config is present", () => {
    expect(() => databasePoolConfigFromEnv({})).toThrow(/DATABASE_URL/);
  });
});

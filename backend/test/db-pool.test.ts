import { describe, expect, it } from "vitest";
import { databasePoolConfigFromEnv, databasePoolConfigFromEnvPrefix } from "../src/db/pool.js";

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

describe("databasePoolConfigFromEnvPrefix", () => {
  it("builds a pg config from WEAVE_DATABASE-style split env vars", () => {
    expect(
      databasePoolConfigFromEnvPrefix("WEAVE_DATABASE", {
        WEAVE_DATABASE_HOST: "db.internal",
        WEAVE_DATABASE_PORT: "5433",
        WEAVE_DATABASE_NAME: "weave",
        WEAVE_DATABASE_USER: "weave_app",
        WEAVE_DATABASE_PASSWORD: "secret",
        WEAVE_DATABASE_SSL: "true",
        WEAVE_DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
      }),
    ).toMatchObject({
      host: "db.internal",
      port: 5433,
      database: "weave",
      user: "weave_app",
      password: "secret",
      ssl: { rejectUnauthorized: false },
    });
  });

  it("throws with the prefixed variable names when a prefixed config is incomplete", () => {
    expect(() =>
      databasePoolConfigFromEnvPrefix("WEAVE_DATABASE", {
        WEAVE_DATABASE_HOST: "db.internal",
      }),
    ).toThrow(
      /WEAVE_DATABASE_URL or WEAVE_DATABASE_HOST, WEAVE_DATABASE_NAME, WEAVE_DATABASE_USER, and WEAVE_DATABASE_PASSWORD/,
    );
  });
});

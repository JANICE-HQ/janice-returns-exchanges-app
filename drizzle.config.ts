/**
 * Drizzle Kit configuratie — JANICE Returns & Exchanges app
 *
 * Gebruik:
 *   npx drizzle-kit generate   → SQL-migratiebestanden aanmaken in db/migrations/
 *   npx drizzle-kit migrate    → Migraties uitvoeren (ALLEEN op Coolify-Postgres)
 *   npx drizzle-kit studio     → Drizzle Studio openen voor DB-inspectie
 *
 * LET OP: Voer `drizzle-kit migrate` NOOIT lokaal uit tenzij DATABASE_URL
 * naar de juiste (dev/staging) database wijst. Coolify voert migraties
 * automatisch uit via het deploy-script.
 */

import type { Config } from "drizzle-kit";

export default {
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "",
  },
  // Uitgebreide logging in development
  verbose: process.env["NODE_ENV"] !== "production",
  strict: true,
} satisfies Config;

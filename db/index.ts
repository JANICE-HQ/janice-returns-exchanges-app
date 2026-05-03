/**
 * Drizzle ORM client factory — JANICE Returns & Exchanges app
 *
 * Leest DATABASE_URL uit de omgevingsvariabelen en exporteert een gedeelde
 * `db`-instantie die kan worden gebruikt in loaders, actions en de service-laag.
 *
 * Verbindingspooling via de `postgres`-driver (max. 10 verbindingen standaard).
 * Pas `max` aan als de Coolify-Postgres-configuratie dit vereist.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// DATABASE_URL-validatie vindt plaats in app/lib/env.server.ts bij het opstarten.
// Hier gaan we ervan uit dat de URL beschikbaar is.
const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error(
    "DATABASE_URL ontbreekt. Zorg dat env.server.ts is geïnitialiseerd vóór de Drizzle-client.",
  );
}

/**
 * Postgres.js-verbindingspool.
 * `max: 10` is geschikt voor één Coolify-container; schaal omhoog indien nodig.
 */
const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

/**
 * Drizzle ORM-client. Exporteer dit in loaders/actions:
 *
 * ```ts
 * import { db } from "~/db/index.server";
 * const alleRetouren = await db.select().from(schema.returns);
 * ```
 */
export const db = drizzle(queryClient, { schema });

/**
 * Herexporteer schema voor gemak — importeer typen vanuit één locatie.
 */
export { schema };

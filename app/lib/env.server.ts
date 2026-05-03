/**
 * Omgevingsvariabelen-validatie — JANICE Returns & Exchanges app
 *
 * Valideert alle vereiste env-vars via Zod bij het opstarten van de server.
 * Als een variabele ontbreekt, gooit de app een fout vóór het accepteren van
 * verzoeken (fail-fast principe). Dit voorkomt stille fouten in productie.
 *
 * Gebruik:
 *   import { env } from "~/lib/env.server";
 *   const token = env.SHOPIFY_ADMIN_TOKEN;
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod-schema voor alle vereiste omgevingsvariabelen
// ---------------------------------------------------------------------------
const envSchema = z.object({
  // --- Node.js runtime ---
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // --- Shopify ---
  SHOPIFY_ADMIN_TOKEN: z
    .string()
    .min(1, "SHOPIFY_ADMIN_TOKEN is vereist (Shopify Admin API access token)"),

  SHOPIFY_SHOP_DOMAIN: z
    .string()
    .min(1, "SHOPIFY_SHOP_DOMAIN is vereist")
    .regex(
      /^[a-z0-9-]+\.myshopify\.com$/,
      "SHOPIFY_SHOP_DOMAIN moet het formaat 'xxx.myshopify.com' hebben",
    ),

  APP_URL: z
    .string()
    .url(
      "APP_URL moet een geldige URL zijn (bijv. https://returns.janice.com)",
    ),

  // --- Database ---
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is vereist (PostgreSQL-verbindingsstring)"),

  // --- Redis ---
  REDIS_URL: z
    .string()
    .min(1, "REDIS_URL is vereist (Redis-verbindingsstring voor BullMQ)"),

  // --- DHL Parcel NL Returns API ---
  DHL_API_KEY: z
    .string()
    .min(1, "DHL_API_KEY is vereist (DHL Parcel NL API-sleutel)"),

  DHL_USER_ID: z
    .string()
    .min(1, "DHL_USER_ID is vereist (DHL Parcel NL gebruikers-ID)"),

  DHL_RETURN_ACCOUNT_ID: z
    .string()
    .min(1, "DHL_RETURN_ACCOUNT_ID is vereist (DHL retouraccount-ID)"),

  DHL_WEBHOOK_SECRET: z
    .string()
    .min(1, "DHL_WEBHOOK_SECRET is vereist (gedeeld geheim voor DHL-webhooks)"),

  // --- GoedGepickt ---
  GOEDGEPICKT_WEBHOOK_SECRET: z
    .string()
    .min(
      1,
      "GOEDGEPICKT_WEBHOOK_SECRET is vereist (HMAC-geheim voor GoedGepickt-webhooks)",
    ),

  // --- Klaviyo ---
  KLAVIYO_PRIVATE_API_KEY: z
    .string()
    .min(
      1,
      "KLAVIYO_PRIVATE_API_KEY is vereist (Klaviyo private API-sleutel voor event-tracking)",
    ),

  // --- Sentry ---
  SENTRY_DSN_RETURNS_APP: z
    .string()
    .url(
      "SENTRY_DSN_RETURNS_APP moet een geldige Sentry DSN-URL zijn",
    )
    .min(1, "SENTRY_DSN_RETURNS_APP is vereist voor foutmonitoring"),
});

// ---------------------------------------------------------------------------
// Valideer de huidige process.env en exporteer het getypeerde object
// ---------------------------------------------------------------------------
function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // Zod v4 gebruikt `issues` in plaats van `errors`
    const missende = result.error.issues
      .map((e) => `  • ${e.path.join(".")}: ${e.message}`)
      .join("\n");

    throw new Error(
      `\n\n[JANICE Returns App] Omgevingsconfiguratie ongeldig.\n` +
        `De volgende variabelen ontbreken of zijn onjuist:\n${missende}\n\n` +
        `Kopieer .env.example naar .env en vul alle waarden in.\n`,
    );
  }

  return result.data;
}

/**
 * Getypeerde env-variabelen — beschikbaar op de server.
 * Dit object is een eenmalig gevalideerde snapshot van process.env.
 *
 * @example
 * import { env } from "~/lib/env.server";
 * const shopUrl = env.SHOPIFY_SHOP_DOMAIN;
 */
export const env = validateEnv();

/**
 * Type-export voor gebruik in functies die env als parameter accepteren.
 */
export type Env = typeof env;

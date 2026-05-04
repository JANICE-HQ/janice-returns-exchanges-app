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

  /**
   * Shopify Admin API access token (legacy/statisch).
   *
   * VEROUDERD: gebruik SHOPIFY_API_KEY + SHOPIFY_API_SECRET voor automatische vernieuwing.
   * Tokens verlopen na 24u — zonder vernieuwing falen alle API-aanroepen.
   *
   * Terugvalpad: als SHOPIFY_API_KEY/SECRET niet zijn ingesteld, wordt dit token gebruikt.
   * Nieuwe implementaties moeten SHOPIFY_API_KEY + SHOPIFY_API_SECRET gebruiken.
   *
   * @deprecated Gebruik SHOPIFY_API_KEY + SHOPIFY_API_SECRET
   */
  SHOPIFY_ADMIN_TOKEN: z
    .string()
    .min(1)
    .optional(),

  SHOPIFY_SHOP_DOMAIN: z
    .string()
    .min(1, "SHOPIFY_SHOP_DOMAIN is vereist")
    .regex(
      /^[a-z0-9-]+\.myshopify\.com$/,
      "SHOPIFY_SHOP_DOMAIN moet het formaat 'xxx.myshopify.com' hebben",
    ),

  /**
   * Shopify Custom App client_id — vereist voor automatische token-vernieuwing.
   * Te vinden in: Shopify Admin → Apps → Jouw app → App credentials → API key.
   *
   * Aanbevolen boven SHOPIFY_ADMIN_TOKEN: tokens worden automatisch elke 24u vernieuwd.
   * Indien niet ingesteld: terugval naar statisch SHOPIFY_ADMIN_TOKEN.
   */
  SHOPIFY_API_KEY: z
    .string()
    .min(1)
    .optional(),

  /**
   * Shopify Custom App client secret — twee doeleinden:
   * 1. OAuth2 client_credentials grant voor token-vernieuwing (nieuw)
   * 2. App Proxy HMAC-verificatie (bestaand)
   *
   * Te vinden in: Shopify Admin → Apps → Jouw app → App credentials → Client secret.
   * NOOIT in code opnemen of vastleggen in versiebeheer.
   */
  SHOPIFY_API_SECRET: z
    .string()
    .min(1, "SHOPIFY_API_SECRET is vereist (Shopify Custom App client secret voor HMAC-verificatie)"),

  APP_URL: z
    .string()
    .url(
      "APP_URL moet een geldige URL zijn (bijv. https://returns.janice.com)",
    ),

  // --- JWT ---
  /**
   * Geheim voor het ondertekenen van gast-JWTs (15 min geldig).
   * Minimaal 32 tekens — gebruik een willekeurige 64-tekens string in productie.
   */
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET moet minimaal 32 tekens bevatten"),

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

  // Waarschuw als noch het sleutelpaar noch het statisch token is ingesteld
  const heeftApiSleutels = result.data.SHOPIFY_API_KEY && result.data.SHOPIFY_API_SECRET;
  const heeftStatischToken = result.data.SHOPIFY_ADMIN_TOKEN;

  if (!heeftApiSleutels && !heeftStatischToken) {
    // Gebruik process.stderr om te vermijden dat env.server.ts een Sentry-module importeert
    // (circulaire afhankelijkheidsrisico). De waarschuwing is zichtbaar in Coolify-logs.
    process.stderr.write(
      JSON.stringify({
        level: "ERROR",
        ts: new Date().toISOString(),
        event: "shopify_credentials_ontbreken",
        message:
          "Geen Shopify-credentials geconfigureerd. " +
          "Stel SHOPIFY_API_KEY + SHOPIFY_API_SECRET in (aanbevolen, automatische vernieuwing) " +
          "of SHOPIFY_ADMIN_TOKEN (legacy, verloopt na 24u). " +
          "Zonder credentials falen alle Shopify Admin API-aanroepen.",
      }) + "\n",
    );
  } else if (!heeftApiSleutels && heeftStatischToken) {
    // Informatieve waarschuwing: statisch token werkt maar verloopt na 24u
    if (result.data.NODE_ENV !== "test") {
      process.stderr.write(
        JSON.stringify({
          level: "WARN",
          ts: new Date().toISOString(),
          event: "shopify_token_statisch_geconfigureerd",
          message:
            "Shopify gebruikt statisch SHOPIFY_ADMIN_TOKEN. " +
            "Dit token verloopt na 24u. " +
            "Voeg SHOPIFY_API_KEY + SHOPIFY_API_SECRET toe voor automatische vernieuwing.",
        }) + "\n",
      );
    }
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

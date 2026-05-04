/**
 * Shopify Admin API Token Manager — JANICE Returns & Exchanges app
 *
 * Beheert automatische vernieuwing van Shopify Admin access tokens.
 * Tokens van de OAuth2 client_credentials grant verlopen na 24u (86400s).
 * Zonder vernieuwing falen alle Shopify GraphQL-aanroepen stil met 401.
 *
 * Architectuur:
 *   SHOPIFY_API_KEY + SHOPIFY_API_SECRET (aanbevolen)
 *     → POST /admin/oauth/access_token (client_credentials)
 *     → Token opgeslagen in Redis (gedeeld over web + worker processen)
 *     → Proactieve vernieuwing 5 minuten vóór verlopen (SAFETY_MARGIN_MS)
 *     → In-flight deduplicatie (geen thundering herd)
 *
 *   Terugvalpad (achterwaartse compatibiliteit):
 *     SHOPIFY_ADMIN_TOKEN (statisch) → token direct retourneren (geen Redis)
 *
 * Gebruik:
 *   import { getShopifyAdminToken, invalidateShopifyAdminToken } from "~/lib/shopify-token-manager.server";
 *   const token = await getShopifyAdminToken();
 */

import * as Sentry from "@sentry/node";
import { redis } from "~/lib/redis.server";

// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------

/** Redis-sleutel voor gecachte token-informatie (JSON) */
export const REDIS_KEY = "shopify:admin:token";

/** Veiligheidsmarge: vernieuw het token 5 minuten vóór verlopen */
export const SAFETY_MARGIN_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/**
 * Token-informatie opgeslagen in Redis (geserialiseerd als JSON).
 */
export interface TokenInfo {
  /** Shopify Admin API access token (shpat_*) */
  accessToken: string;
  /** Vervaltijdstip in epoch-milliseconden */
  expiresAt: number;
}

/**
 * Fout gegooid als Shopify OAuth-eindpunt een niet-2xx-respons retourneert
 * na een mislukte tokenvernieuwing.
 */
export class ShopifyAuthFout extends Error {
  public readonly statusCode: number;

  constructor(bericht: string, statusCode: number) {
    super(bericht);
    this.name = "ShopifyAuthFout";
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// In-process deduplicatie (thundering herd voorkomen)
// ---------------------------------------------------------------------------

/**
 * Lopende vernieuwingsbelofte — gedeeld over alle gelijktijdige aanroepende.
 * Null als er geen vernieuwing actief is.
 */
let inFlight: Promise<TokenInfo> | null = null;

/**
 * Vlag voor eenmalige waarschuwingslog bij ontbrekende credentials.
 * Voorkomt spam: de waarschuwing verschijnt maximaal één keer per processtart.
 */
let terugvalWaarschuwingGelogd = false;

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

/**
 * Retourneert een geldig Shopify Admin API-token.
 *
 * Volgorde:
 * 1. Controleer Redis — als token aanwezig en niet bijna verlopen → direct retourneren
 * 2. Als vernieuwing al loopt → wacht op die belofte (geen thundering herd)
 * 3. Start nieuwe vernieuwing → sla op in Redis → retourneer token
 *
 * Terugvalpad: als SHOPIFY_API_KEY of SHOPIFY_API_SECRET niet is ingesteld,
 * retourneer het statische SHOPIFY_ADMIN_TOKEN uit de omgevingsvariabelen.
 *
 * @throws {ShopifyAuthFout} Als tokenvernieuwing mislukt
 * @throws {Error} Als geen credentials beschikbaar zijn
 */
export async function getShopifyAdminToken(): Promise<string> {
  // --- Terugvalpad: statische token via omgevingsvariabele ---
  const apiKey = process.env["SHOPIFY_API_KEY"];
  const apiSecret = process.env["SHOPIFY_API_SECRET"];

  if (!apiKey || !apiSecret) {
    return _terugvalNaarStatischeToken();
  }

  // --- Stap 1: Controleer Redis-cache ---
  try {
    const gecachteToken = await _haalUitRedis();
    if (gecachteToken && gecachteToken.expiresAt > Date.now() + SAFETY_MARGIN_MS) {
      return gecachteToken.accessToken;
    }
  } catch (fout) {
    // Redis-fout: ga door naar vernieuwing als fallback
    process.stderr.write(
      JSON.stringify({
        level: "WARN",
        ts: new Date().toISOString(),
        event: "shopify_token_redis_leesfout",
        message: "Kon token niet uit Redis lezen — probeer vernieuwing",
        error: fout instanceof Error ? fout.message : String(fout),
      }) + "\n",
    );
  }

  // --- Stap 2 + 3: Vernieuw token (met in-flight deduplicatie) ---
  if (inFlight) {
    const tokenInfo = await inFlight;
    return tokenInfo.accessToken;
  }

  inFlight = _vernieuwToken(apiKey, apiSecret).finally(() => {
    inFlight = null;
  });

  const tokenInfo = await inFlight;
  return tokenInfo.accessToken;
}

/**
 * Invalideert het gecachte token in Redis.
 * Gebruik dit op het 401-terugvalpad zodat de volgende aanroep een vers token ophaalt.
 */
export async function invalidateShopifyAdminToken(): Promise<void> {
  try {
    await redis.del(REDIS_KEY);
    process.stdout.write(
      JSON.stringify({
        level: "INFO",
        ts: new Date().toISOString(),
        event: "shopify_token_geinvalideerd",
        message: "Token uit Redis verwijderd — volgende aanroep haalt vers token op",
      }) + "\n",
    );
  } catch (fout) {
    // Redis-fout bij invalidatie: loggeerbaar maar niet fataal
    process.stderr.write(
      JSON.stringify({
        level: "WARN",
        ts: new Date().toISOString(),
        event: "shopify_token_invalidatie_fout",
        error: fout instanceof Error ? fout.message : String(fout),
      }) + "\n",
    );
  }
}

// ---------------------------------------------------------------------------
// Interne hulpfuncties
// ---------------------------------------------------------------------------

/**
 * Haalt gecachte TokenInfo op uit Redis.
 * Retourneert null als de sleutel niet bestaat of JSON-parsing mislukt.
 */
async function _haalUitRedis(): Promise<TokenInfo | null> {
  const raw = await redis.get(REDIS_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as TokenInfo;
  } catch {
    return null;
  }
}

/**
 * Vernieuwt het Shopify Admin token via OAuth2 client_credentials grant.
 * Slaat het resultaat op in Redis en retourneert TokenInfo.
 *
 * Omwikkeld met Sentry-span voor observability.
 *
 * @param apiKey    - Shopify Custom App client_id
 * @param apiSecret - Shopify Custom App client_secret
 * @throws {ShopifyAuthFout} Bij niet-2xx OAuth-respons
 */
async function _vernieuwToken(apiKey: string, apiSecret: string): Promise<TokenInfo> {
  const shopDomain = process.env["SHOPIFY_SHOP_DOMAIN"];
  if (!shopDomain) {
    throw new Error("SHOPIFY_SHOP_DOMAIN is vereist voor token-vernieuwing");
  }

  return Sentry.startSpan(
    {
      op: "http.client",
      name: "shopify.oauth.refresh",
      attributes: {
        "http.method": "POST",
        "http.url": `https://${shopDomain}/admin/oauth/access_token`,
        "shopify.shop": shopDomain,
      },
    },
    async () => {
      const url = `https://${shopDomain}/admin/oauth/access_token`;

      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "shopify_token_vernieuwing_start",
          shop: shopDomain,
        }) + "\n",
      );

      let respons: Response;

      try {
        respons = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: apiKey,
            client_secret: apiSecret,
            grant_type: "client_credentials",
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (fout) {
        const bericht = fout instanceof Error ? fout.message : String(fout);
        const netwerkFout = new Error(
          `Shopify OAuth-eindpunt niet bereikbaar (${shopDomain}): ${bericht}`,
        );
        Sentry.captureException(netwerkFout, {
          tags: { "shopify.shop": shopDomain, event: "shopify_token_netwerk_fout" },
        });
        throw netwerkFout;
      }

      // Niet-2xx respons — kritieke fout, applicatie kan niet doorgaan
      if (!respons.ok) {
        let foutTekst = "";
        try {
          foutTekst = await respons.text();
        } catch {
          // Negeer parse-fouten in de foutrespons
        }

        const authFout = new ShopifyAuthFout(
          `Shopify OAuth mislukt — HTTP ${respons.status}: ${foutTekst}`,
          respons.status,
        );

        Sentry.captureException(authFout, {
          tags: {
            "shopify.shop": shopDomain,
            "http.status_code": respons.status,
            event: "shopify_token_auth_fout",
          },
          extra: { antwoord: foutTekst },
        });

        process.stderr.write(
          JSON.stringify({
            level: "ERROR",
            ts: new Date().toISOString(),
            event: "shopify_token_vernieuwing_mislukt",
            shop: shopDomain,
            status: respons.status,
            error: foutTekst,
            message: "Shopify Admin token-vernieuwing mislukt — kritieke fout, handmatige actie vereist",
          }) + "\n",
        );

        throw authFout;
      }

      // Parse OAuth-respons
      let oauthData: { access_token: string; scope: string; expires_in: number };
      try {
        oauthData = (await respons.json()) as typeof oauthData;
      } catch {
        throw new Error("Shopify OAuth stuurde ongeldig JSON terug");
      }

      const nu = Date.now();
      const expiresAt = nu + oauthData.expires_in * 1000;

      const tokenInfo: TokenInfo = {
        accessToken: oauthData.access_token,
        expiresAt,
      };

      // Sla op in Redis met TTL = expires_in - 60 seconden
      // Redis verwijdert de sleutel voordat Shopify het token ongeldig maakt
      const redisTtlSeconds = oauthData.expires_in - 60;
      try {
        await redis.set(REDIS_KEY, JSON.stringify(tokenInfo), "EX", redisTtlSeconds);
      } catch (fout) {
        // Redis-fout bij opslaan: loggeerbaar maar token is wel geldig
        process.stderr.write(
          JSON.stringify({
            level: "WARN",
            ts: new Date().toISOString(),
            event: "shopify_token_redis_schrijffout",
            error: fout instanceof Error ? fout.message : String(fout),
            message: "Token opgehaald maar kon niet in Redis opslaan — volgende aanroep vernieuwt opnieuw",
          }) + "\n",
        );
      }

      const verloopdatum = new Date(expiresAt).toISOString();
      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "shopify_token_vernieuwd",
          shop: shopDomain,
          expires_at: verloopdatum,
          redis_ttl_seconds: redisTtlSeconds,
          scope: oauthData.scope,
        }) + "\n",
      );

      return tokenInfo;
    },
  );
}

/**
 * Terugvalpad: retourneer statisch SHOPIFY_ADMIN_TOKEN.
 * Logt eenmalig een waarschuwing dat de nieuwe OAuth-flow niet is geconfigureerd.
 */
function _terugvalNaarStatischeToken(): string {
  if (!terugvalWaarschuwingGelogd) {
    terugvalWaarschuwingGelogd = true;
    process.stderr.write(
      JSON.stringify({
        level: "WARN",
        ts: new Date().toISOString(),
        event: "shopify_token_statisch_terugval",
        message:
          "SHOPIFY_API_KEY of SHOPIFY_API_SECRET niet ingesteld — " +
          "terugval naar statisch SHOPIFY_ADMIN_TOKEN. " +
          "Voeg SHOPIFY_API_KEY + SHOPIFY_API_SECRET toe voor automatische token-vernieuwing.",
      }) + "\n",
    );
  }

  const statischToken = process.env["SHOPIFY_ADMIN_TOKEN"];
  if (!statischToken) {
    throw new Error(
      "Geen Shopify-credentials geconfigureerd: " +
        "stel SHOPIFY_API_KEY + SHOPIFY_API_SECRET in (aanbevolen) " +
        "of SHOPIFY_ADMIN_TOKEN (legacy).",
    );
  }

  return statischToken;
}

/**
 * Resetfunctie voor tests — reset interne state.
 * Exporteer ALLEEN voor testdoeleinden.
 * @internal
 */
export function _resetTokenManagerVoorTests(): void {
  inFlight = null;
  terugvalWaarschuwingGelogd = false;
}

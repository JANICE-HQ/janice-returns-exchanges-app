/**
 * Shopify Admin GraphQL client — JANICE Returns & Exchanges app
 *
 * Minimale GraphQL-client gebouwd op de ingebouwde fetch (Node 18+).
 * Geen externe Shopify-libraries — bewust om afhankelijkheden minimaal te houden.
 *
 * Token-beheer:
 *   Tokens worden opgehaald via shopify-token-manager.server.ts die automatisch
 *   vernieuwt vóór verlopen (OAuth2 client_credentials, 24u geldigheid).
 *   Bij een 401-respons wordt het token geïnvalideerd en één keer opnieuw geprobeerd.
 *
 * Gebruik:
 *   import { shopifyAdmin } from "~/lib/shopify.server";
 *
 *   const data = await shopifyAdmin<{ shop: { name: string } }>(
 *     `{ shop { name } }`
 *   );
 *   console.log(data.shop.name); // "JANICE"
 */

import { env } from "~/lib/env.server";
import { SHOPIFY_GRAPHQL_URL } from "~/lib/constants";
import {
  getShopifyAdminToken,
  invalidateShopifyAdminToken,
  ShopifyAuthFout,
} from "~/lib/shopify-token-manager.server";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/** GraphQL-antwoord wrapper van Shopify Admin API */
interface ShopifyGraphQLAntwoord<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

/** Fout gegooid bij Shopify GraphQL-fouten */
export class ShopifyGraphQLFout extends Error {
  public readonly fouten: Array<{ message: string }>;
  public readonly query: string;

  constructor(fouten: Array<{ message: string }>, query: string) {
    const berichten = fouten.map((e) => e.message).join("; ");
    super(`Shopify GraphQL-fout: ${berichten}`);
    this.name = "ShopifyGraphQLFout";
    this.fouten = fouten;
    this.query = query;
  }
}

/** Fout gegooid bij HTTP-fouten (niet 200-range) */
export class ShopifyHTTPFout extends Error {
  public readonly statusCode: number;
  public readonly statusText: string;

  constructor(statusCode: number, statusText: string) {
    super(`Shopify HTTP-fout: ${statusCode} ${statusText}`);
    this.name = "ShopifyHTTPFout";
    this.statusCode = statusCode;
    this.statusText = statusText;
  }
}

// Re-exporteer ShopifyAuthFout zodat callers het kunnen opvangen
export { ShopifyAuthFout };

// ---------------------------------------------------------------------------
// Configuratie
// ---------------------------------------------------------------------------

/**
 * Maximum aantal milliseconden te wachten op een Shopify-respons.
 */
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Interne fetch-helper
// ---------------------------------------------------------------------------

/**
 * Voer één HTTP-verzoek uit naar de Shopify Admin GraphQL API.
 * Retourneert de ruwe Response (statuscontrole vindt plaats in de hoofd-client).
 */
async function _voerFetchUit(
  token: string,
  lichaam: string,
): Promise<Response> {
  const url = SHOPIFY_GRAPHQL_URL(env.SHOPIFY_SHOP_DOMAIN);

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
      // Correlatie-ID voor tracing in Sentry en logs
      "X-Request-ID": crypto.randomUUID(),
    },
    body: lichaam,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

// ---------------------------------------------------------------------------
// Hoofd-client
// ---------------------------------------------------------------------------

/**
 * Voer een Shopify Admin GraphQL-query of -mutatie uit.
 *
 * Token-beheer:
 *   - Token wordt opgehaald via de token manager (automatische vernieuwing)
 *   - Bij een 401-respons: token geïnvalideerd, één herpoging met vers token
 *   - Na twee opeenvolgende 401's: ShopifyAuthFout gegooid
 *
 * @param query      - GraphQL-query of mutatie (string)
 * @param variabelen - Optionele variabelen voor de query
 * @returns Getypeerde `data` uit het Shopify-antwoord
 * @throws ShopifyGraphQLFout — bij GraphQL-fouten in het antwoord
 * @throws ShopifyHTTPFout   — bij niet-2xx HTTP-statuscodes (excl. 401)
 * @throws ShopifyAuthFout   — bij aanhoudende 401 na token-vernieuwing
 * @throws Error             — bij netwerk-/timeout-fouten
 *
 * @example Eenvoudige query
 * ```ts
 * const { shop } = await shopifyAdmin<{ shop: { name: string } }>(
 *   `{ shop { name } }`
 * );
 * ```
 *
 * @example Query met variabelen
 * ```ts
 * const { order } = await shopifyAdmin<{ order: Order }>(
 *   `query GetOrder($id: ID!) { order(id: $id) { id name } }`,
 *   { id: "gid://shopify/Order/1234567890" }
 * );
 * ```
 *
 * @example Mutatie
 * ```ts
 * const { returnCreate } = await shopifyAdmin<{ returnCreate: ReturnCreatePayload }>(
 *   `mutation ReturnCreate($input: ReturnCreateInput!) {
 *     returnCreate(input: $input) {
 *       return { id }
 *       userErrors { field message }
 *     }
 *   }`,
 *   { input: { ... } }
 * );
 * ```
 */
export async function shopifyAdmin<T>(
  query: string,
  variabelen?: Record<string, unknown>,
): Promise<T> {
  const lichaam = JSON.stringify({
    query,
    ...(variabelen ? { variables: variabelen } : {}),
  });

  // --- Haal token op via token manager (met automatische vernieuwing) ---
  let token: string;
  try {
    token = await getShopifyAdminToken();
  } catch (fout) {
    const bericht = fout instanceof Error ? fout.message : String(fout);
    throw new Error(`Kon Shopify Admin token niet ophalen: ${bericht}`);
  }

  // --- Eerste poging ---
  let antwoord: Response;
  try {
    antwoord = await _voerFetchUit(token, lichaam);
  } catch (fout) {
    const bericht =
      fout instanceof Error ? fout.message : "Onbekende netwerkfout";
    throw new Error(
      `Shopify Admin API niet bereikbaar (${env.SHOPIFY_SHOP_DOMAIN}): ${bericht}`,
    );
  }

  // --- 401-retry: invalideer token en probeer opnieuw met vers token ---
  if (antwoord.status === 401) {
    process.stdout.write(
      JSON.stringify({
        level: "WARN",
        ts: new Date().toISOString(),
        event: "shopify_graphql_401_retry",
        message: "Shopify Admin API retourneerde 401 — token wordt geïnvalideerd en vernieuwd",
        shop: env.SHOPIFY_SHOP_DOMAIN,
      }) + "\n",
    );

    await invalidateShopifyAdminToken();

    try {
      token = await getShopifyAdminToken();
    } catch (fout) {
      const bericht = fout instanceof Error ? fout.message : String(fout);
      throw new ShopifyAuthFout(
        `Token-vernieuwing mislukt na 401: ${bericht}`,
        401,
      );
    }

    try {
      antwoord = await _voerFetchUit(token, lichaam);
    } catch (fout) {
      const bericht =
        fout instanceof Error ? fout.message : "Onbekende netwerkfout";
      throw new Error(
        `Shopify Admin API niet bereikbaar na token-vernieuwing (${env.SHOPIFY_SHOP_DOMAIN}): ${bericht}`,
      );
    }

    // Na tweede poging nog steeds 401 — token is ingetrokken of ongeldige credentials
    if (antwoord.status === 401) {
      throw new ShopifyAuthFout(
        "Token-vernieuwing mislukt — token nog steeds geweigerd na herpoging. " +
          "Controleer SHOPIFY_API_KEY en SHOPIFY_API_SECRET in Shopify Admin.",
        401,
      );
    }
  }

  // --- HTTP-statuscontrole (voor alle overige niet-2xx-statussen) ---
  if (!antwoord.ok) {
    throw new ShopifyHTTPFout(antwoord.status, antwoord.statusText);
  }

  // --- Parseer JSON-antwoord ---
  let json: ShopifyGraphQLAntwoord<T>;

  try {
    json = (await antwoord.json()) as ShopifyGraphQLAntwoord<T>;
  } catch {
    throw new Error("Shopify API stuurde ongeldig JSON terug");
  }

  // --- GraphQL-foutcontrole ---
  if (json.errors?.length) {
    throw new ShopifyGraphQLFout(json.errors, query);
  }

  // --- Data-aanwezigheidscontrole ---
  if (json.data === undefined || json.data === null) {
    throw new Error(
      "Shopify API stuurde een antwoord zonder 'data'-veld — controleer de query",
    );
  }

  return json.data;
}

/**
 * Shopify API-versie die momenteel in gebruik is.
 * Handig voor logging en health checks.
 * Re-export vanuit ~/lib/constants voor backwards-compatibiliteit.
 */
export { SHOPIFY_API_VERSION as shopifyApiVersie } from "~/lib/constants";

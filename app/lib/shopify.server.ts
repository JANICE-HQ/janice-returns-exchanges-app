/**
 * Shopify Admin GraphQL client — JANICE Returns & Exchanges app
 *
 * Minimale GraphQL-client gebouwd op de ingebouwde fetch (Node 18+).
 * Geen externe Shopify-libraries — bewust om afhankelijkheden minimaal te houden.
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

// ---------------------------------------------------------------------------
// Configuratie
// ---------------------------------------------------------------------------

/**
 * Maximum aantal seconden te wachten op een Shopify-respons.
 */
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Hoofd-client
// ---------------------------------------------------------------------------

/**
 * Voer een Shopify Admin GraphQL-query of -mutatie uit.
 *
 * @param query   - GraphQL-query of mutatie (string)
 * @param variabelen - Optionele variabelen voor de query
 * @returns Getypeerde `data` uit het Shopify-antwoord
 * @throws ShopifyGraphQLFout — bij GraphQL-fouten in het antwoord
 * @throws ShopifyHTTPFout   — bij niet-2xx HTTP-statuscodes
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
  const url = SHOPIFY_GRAPHQL_URL(env.SHOPIFY_SHOP_DOMAIN);

  const lichaam = JSON.stringify({
    query,
    ...(variabelen ? { variables: variabelen } : {}),
  });

  let antwoord: Response;

  try {
    antwoord = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN,
        // Correlatie-ID voor tracing in Sentry en logs
        "X-Request-ID": crypto.randomUUID(),
      },
      body: lichaam,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (fout) {
    // Netwerk- of timeout-fout
    const bericht =
      fout instanceof Error ? fout.message : "Onbekende netwerkfout";
    throw new Error(
      `Shopify Admin API niet bereikbaar (${env.SHOPIFY_SHOP_DOMAIN}): ${bericht}`,
    );
  }

  // HTTP-statuscontrole
  if (!antwoord.ok) {
    throw new ShopifyHTTPFout(antwoord.status, antwoord.statusText);
  }

  // Parseer JSON-antwoord
  let json: ShopifyGraphQLAntwoord<T>;

  try {
    json = (await antwoord.json()) as ShopifyGraphQLAntwoord<T>;
  } catch {
    throw new Error("Shopify API stuurde ongeldig JSON terug");
  }

  // GraphQL-foutcontrole
  if (json.errors?.length) {
    throw new ShopifyGraphQLFout(json.errors, query);
  }

  // Data-aanwezigheidscontrole
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

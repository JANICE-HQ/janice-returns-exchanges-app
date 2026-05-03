/**
 * Shopify App Proxy HMAC-verificatie — JANICE Returns & Exchanges app
 *
 * Verhardt de stub uit PR #1 conform Shopify's App Proxy HMAC-specificatie:
 *  - HMAC-SHA256 van de canonieke querystring
 *  - Canonieke querystring: alle parameters gesorteerd op sleutel (behalve 'signature'),
 *    samengevoegd als "key=value" ZONDER scheidingstekens
 *  - Sleutel: SHOPIFY_API_SECRET (Custom App client secret)
 *  - Constante tijdvergelijking via crypto.timingSafeEqual
 *
 * Referentie: https://shopify.dev/docs/apps/build/online-store/app-proxies#calculate-a-digital-signature
 *
 * Gebruik:
 *   import { appProxyMiddleware } from "~/lib/app-proxy-hmac.server";
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { LoaderFunctionArgs } from "react-router";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface ShopifyProxyContext {
  /** Shopify-winkeldomeinnaam, bijv. "u17s8e-sc.myshopify.com" */
  shop: string;
  /** Shopify customer_id van de ingelogde klant — null voor gasten */
  loggedInCustomerId: string | null;
  /** App Proxy-padprefix (path_prefix param van Shopify) */
  pathPrefix: string;
}

/** Fout bij ongeldig of ontbrekend HMAC-handtekening */
export class HmacVerificatieFout extends Error {
  public readonly reden: string;
  constructor(reden: string) {
    super(`App Proxy HMAC-verificatie mislukt: ${reden}`);
    this.name = "HmacVerificatieFout";
    this.reden = reden;
  }
}

// ---------------------------------------------------------------------------
// HMAC-verificatie (pure functie — testbaar)
// ---------------------------------------------------------------------------

/**
 * Verifieer een Shopify App Proxy HMAC-handtekening.
 *
 * Algoritme (Shopify-spec):
 *  1. Haal 'signature' op uit de queryparams
 *  2. Sorteer alle overige params op sleutel
 *  3. Voeg samen als "key=value" ZONDER scheidingstekens
 *  4. Bereken HMAC-SHA256 met SHOPIFY_API_SECRET als sleutel
 *  5. Vergelijk via timingSafeEqual
 *
 * @param queryParams - URLSearchParams of Record<string, string>
 * @param geheim      - SHOPIFY_API_SECRET (client_secret)
 * @throws {HmacVerificatieFout} als handtekening ontbreekt of ongeldig is
 */
export function verifieerAppProxyHmac(
  queryParams: URLSearchParams | Record<string, string>,
  geheim: string,
): void {
  const params: Record<string, string> =
    queryParams instanceof URLSearchParams
      ? Object.fromEntries(queryParams.entries())
      : queryParams;

  const ontvangen = params["signature"];
  if (!ontvangen) {
    throw new HmacVerificatieFout("'signature' parameter ontbreekt in querystring");
  }

  // Bouw canonieke string: gesorteerde key=value paren ZONDER scheidingsteken
  const canoniek = Object.keys(params)
    .filter((sleutel) => sleutel !== "signature")
    .sort()
    .map((sleutel) => `${sleutel}=${params[sleutel] ?? ""}`)
    .join("");

  // Bereken verwachte HMAC
  const verwacht = createHmac("sha256", geheim)
    .update(canoniek, "utf8")
    .digest("hex");

  // Constante-tijdvergelijking — voorkomt timing-aanvallen
  const ontvangenBuffer = Buffer.from(ontvangen, "utf8");
  const verwachtBuffer = Buffer.from(verwacht, "utf8");

  // Lengte moet gelijk zijn voor timingSafeEqual
  if (ontvangenBuffer.length !== verwachtBuffer.length) {
    throw new HmacVerificatieFout("Handtekening heeft ongeldige lengte");
  }

  const geldig = timingSafeEqual(ontvangenBuffer, verwachtBuffer);
  if (!geldig) {
    throw new HmacVerificatieFout("Handtekening komt niet overeen");
  }
}

/**
 * Extraheer Shopify App Proxy-context uit de querystring.
 * Aanwezig na succesvolle HMAC-verificatie.
 */
export function extracteerProxyContext(
  queryParams: URLSearchParams | Record<string, string>,
): ShopifyProxyContext {
  const params: Record<string, string> =
    queryParams instanceof URLSearchParams
      ? Object.fromEntries(queryParams.entries())
      : queryParams;

  return {
    shop: params["shop"] ?? "",
    // logged_in_customer_id is aanwezig als de klant is ingelogd in de Shopify-winkel
    loggedInCustomerId: params["logged_in_customer_id"] ?? null,
    pathPrefix: params["path_prefix"] ?? "/apps/returns",
  };
}

// ---------------------------------------------------------------------------
// Middleware factory voor React Router routes
// ---------------------------------------------------------------------------

/**
 * Verifieer de App Proxy HMAC-handtekening van een inkomend verzoek.
 * Gebruik dit in elke route onder /apps/returns/*.
 *
 * @example
 * export async function action({ request }: ActionFunctionArgs) {
 *   const context = await verifieerEnExtraheerProxyContext(request);
 *   // context.loggedInCustomerId is beschikbaar als de klant is ingelogd
 * }
 */
export async function verifieerEnExtraheerProxyContext(
  request: Request,
): Promise<ShopifyProxyContext> {
  const url = new URL(request.url);
  const queryParams = url.searchParams;

  const geheim = process.env["SHOPIFY_API_SECRET"];
  if (!geheim) {
    throw new Error("SHOPIFY_API_SECRET ontbreekt in omgevingsvariabelen");
  }

  verifieerAppProxyHmac(queryParams, geheim);
  return extracteerProxyContext(queryParams);
}

// ---------------------------------------------------------------------------
// Hulpfunctie: standaard 401-foutreactie
// ---------------------------------------------------------------------------

export function maakOngeautoriseerdAntwoord(reden: string): Response {
  return Response.json(
    {
      error: {
        code: "signature_invalid",
        message: reden,
      },
    },
    { status: 401 },
  );
}

// ---------------------------------------------------------------------------
// Hulpfunctie: standaard foutreactie-envelope
// ---------------------------------------------------------------------------

export function maakFoutAntwoord(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    { status },
  );
}

// ---------------------------------------------------------------------------
// Loader-args type-uitbreiding met proxy-context
// ---------------------------------------------------------------------------

export interface ProxyLoaderArgs extends LoaderFunctionArgs {
  shopifyContext: ShopifyProxyContext;
}

/**
 * Test-hulpfuncties — JANICE Returns & Exchanges app
 *
 * Gedeelde hulpfuncties voor integratie- en unit-tests van de App Proxy eindpunten.
 * Bevat: mock-factories, Shopify HMAC-signing, database-fixtures.
 */

import { createHmac } from "crypto";
import type { ShopifyOrder, ShopifyLineItem } from "~/services/eligibility";

// ---------------------------------------------------------------------------
// HMAC-handtekening helper
// ---------------------------------------------------------------------------

/**
 * Maak een geldige Shopify App Proxy query-string aan inclusief HMAC-handtekening.
 * Gebruikt dezelfde algoritme als Shopify's specificatie.
 */
export function maakGeldigeProxyQueryString(
  geheim: string,
  extraParams: Record<string, string> = {},
): string {
  const params: Record<string, string> = {
    shop: "test-shop.myshopify.com",
    path_prefix: "/apps/returns",
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...extraParams,
  };

  // Bereken canonieke string
  const canoniek = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k] ?? ""}`)
    .join("");

  const handtekening = createHmac("sha256", geheim)
    .update(canoniek, "utf8")
    .digest("hex");

  params["signature"] = handtekening;

  return new URLSearchParams(params).toString();
}

/**
 * Maak een Request-object aan met geldige Shopify HMAC-handtekening.
 */
export function maakProxyRequest(opties: {
  method?: string;
  path?: string;
  body?: unknown;
  geheim?: string;
  extraQueryParams?: Record<string, string>;
}): Request {
  const {
    method = "POST",
    path = "/apps/returns/start",
    body,
    geheim = "test-geheim-abcdefghijklmnopqrstuvwxyz123456",
    extraQueryParams = {},
  } = opties;

  const queryString = maakGeldigeProxyQueryString(geheim, extraQueryParams);
  const url = `https://shop.example.com${path}?${queryString}`;

  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Maak een Request zonder HMAC-handtekening (voor negatieve tests).
 */
export function maakOngetekendeRequest(opties: {
  method?: string;
  path?: string;
  body?: unknown;
}): Request {
  const { method = "POST", path = "/apps/returns/start", body } = opties;
  const url = `https://shop.example.com${path}`;

  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Mock Shopify-bestelling factory
// ---------------------------------------------------------------------------

/** Uitgebreid line-item type voor test-helpers */
interface TestLineItem extends ShopifyLineItem {
  variantTitle?: string | null;
  sku?: string | null;
}

export function maakMockBestelling(overschrijf: Partial<{
  id: string;
  name: string;
  customerEmail: string;
  customerId: string | null;
  financialStatus: string;
  fulfillmentStatus: string;
  fulfillments: Array<{ createdAt: string; deliveredAt?: string | null }>;
  lineItems: TestLineItem[];
}> = {}): ShopifyOrder & { customerEmail: string; customerId: string | null } {
  return {
    id: "gid://shopify/Order/12345",
    name: "#1042",
    customerEmail: "klant@voorbeeld.nl",
    customerId: "gid://shopify/Customer/99999",
    financialStatus: "paid",
    fulfillmentStatus: "fulfilled",
    fulfillments: [
      {
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        deliveredAt: null,
      },
    ],
    lineItems: [
      {
        id: "gid://shopify/LineItem/111",
        variantId: "gid://shopify/ProductVariant/222",
        productId: "gid://shopify/Product/333",
        productTitle: "JANICE Blazer Camel",
        productType: "blazer",
        tags: ["new-arrival"],
        quantity: 2,
        originalUnitPrice: "189.95",
        discountedUnitPrice: "189.95",
        compareAtPrice: null,
        metafields: [],
      } as TestLineItem,
    ],
    ...overschrijf,
  } as ShopifyOrder & { customerEmail: string; customerId: string | null };
}

/**
 * Maak een mock-bestelling met een final-sale artikel.
 */
export function maakFinalSaleBestelling(): ShopifyOrder & { customerEmail: string; customerId: string | null } {
  const bestelling = maakMockBestelling();
  return {
    ...bestelling,
    lineItems: bestelling.lineItems.map((item) => ({
      ...item,
      metafields: [
        { namespace: "custom", key: "is_final_sale", value: "true" },
      ],
    })),
  };
}

/**
 * Maak een mock-bestelling met een verlopen retourvenster.
 */
export function maakVerlopenBestelling(): ShopifyOrder & { customerEmail: string; customerId: string | null } {
  return maakMockBestelling({
    fulfillments: [
      {
        createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 dagen geleden
        deliveredAt: null,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Standaard test-idempotency-sleutel
// ---------------------------------------------------------------------------

export function nieuweIdempotencySleutel(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Gestandaardiseerde aanvraag-body's
// ---------------------------------------------------------------------------

export function maakStartReturnBody(overschrijf: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    shopifyOrderId: "gid://shopify/Order/12345",
    lineItems: [
      {
        shopifyLineItemId: "gid://shopify/LineItem/111",
        quantity: 1,
        reasonCode: "CHANGED_MIND",
      },
    ],
    idempotencyKey: nieuweIdempotencySleutel(),
    ...overschrijf,
  };
}

export function maakGuestLookupBody(overschrijf: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderName: "#1042",
    email: "klant@voorbeeld.nl",
    idempotencyKey: nieuweIdempotencySleutel(),
    ...overschrijf,
  };
}

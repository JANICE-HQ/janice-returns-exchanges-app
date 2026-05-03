/**
 * Shopify Admin GraphQL queries — JANICE Returns & Exchanges app
 *
 * Bevat alle queries die nodig zijn voor de App Proxy eindpunten.
 * Alle queries fetchen de benodigde velden voor eligibility-controles.
 *
 * Geen live API-aanroepen in tests — mock via vi.mock("~/lib/shopify.server").
 */

import { shopifyAdmin } from "~/lib/shopify.server";
import type { ShopifyOrder, ShopifyLineItem } from "~/services/eligibility";

// ---------------------------------------------------------------------------
// Uitgebreid line-item type met extra velden voor routes
// ---------------------------------------------------------------------------

/**
 * Uitgebreid ShopifyLineItem met extra velden die beschikbaar zijn na het
 * ophalen via de Admin GraphQL API maar niet in het minimale eligibility-type.
 */
export interface ShopifyLineItemUitgebreid extends ShopifyLineItem {
  /** Variantnaam, bijv. "Camel / M" — null als enkelvoudige variant */
  variantTitle: string | null;
  /** SKU-code — null als niet ingesteld */
  sku: string | null;
}

/**
 * Uitgebreid ShopifyOrder type met klantinformatie voor routes.
 */
export interface ShopifyOrderUitgebreid extends Omit<ShopifyOrder, "lineItems"> {
  customerEmail: string;
  customerId: string | null;
  lineItems: ShopifyLineItemUitgebreid[];
}

// ---------------------------------------------------------------------------
// Typen voor de Shopify API-reactie
// ---------------------------------------------------------------------------

interface ShopifyLineItemApiResponse {
  id: string;
  product?: {
    id: string;
    title: string;
    productType: string;
    tags: string[];
    metafield?: {
      namespace: string;
      key: string;
      value: string;
    } | null;
  } | null;
  quantity: number;
  originalUnitPriceSet: {
    shopMoney: { amount: string; currencyCode: string };
  };
  discountedUnitPriceSet: {
    shopMoney: { amount: string; currencyCode: string };
  };
  variant?: {
    compareAtPrice?: string | null;
    id: string;
    title: string;
    sku?: string | null;
  } | null;
}

interface ShopifyOrderApiResponse {
  id: string;
  name: string;
  email: string;
  customer?: {
    id: string;
    email: string;
  } | null;
  financialStatus: string;
  displayFulfillmentStatus: string;
  fulfillments: Array<{
    createdAt: string;
    deliveredAt?: string | null;
    status: string;
  }>;
  lineItems: {
    nodes: ShopifyLineItemApiResponse[];
  };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// GraphQL-fragment voor line items met alle benodigde velden
// ---------------------------------------------------------------------------

const LINE_ITEMS_FRAGMENT = `
  lineItems(first: 50) {
    nodes {
      id
      quantity
      originalUnitPriceSet {
        shopMoney { amount currencyCode }
      }
      discountedUnitPriceSet {
        shopMoney { amount currencyCode }
      }
      variant {
        id
        title
        sku
        compareAtPrice
      }
      product {
        id
        title
        productType
        tags
        metafield(namespace: "custom", key: "is_final_sale") {
          namespace
          key
          value
        }
      }
    }
  }
`;

const ORDER_FIELDS = `
  id
  name
  email
  customer {
    id
    email
  }
  financialStatus
  displayFulfillmentStatus
  fulfillments {
    createdAt
    deliveredAt
    status
  }
  createdAt
  ${LINE_ITEMS_FRAGMENT}
`;

// ---------------------------------------------------------------------------
// Query: Ophalen van een bestelling op GID
// ---------------------------------------------------------------------------

const HAAL_BESTELLING_OP_ID = `
  query HaalBestellingOpId($id: ID!) {
    order(id: $id) {
      ${ORDER_FIELDS}
    }
  }
`;

/**
 * Haal een Shopify-bestelling op via het GID.
 *
 * @param orderId - Shopify Order GID (bijv. "gid://shopify/Order/12345")
 * @returns Gemapte ShopifyOrderUitgebreid of null als niet gevonden
 */
export async function haalBestellingOpId(
  orderId: string,
): Promise<ShopifyOrderUitgebreid | null> {
  const data = await shopifyAdmin<{
    order: ShopifyOrderApiResponse | null;
  }>(HAAL_BESTELLING_OP_ID, { id: orderId });

  if (!data.order) return null;

  return mapeerBestellingNaarModel(data.order);
}

// ---------------------------------------------------------------------------
// Query: Ophalen van een bestelling op naam + e-mail
// ---------------------------------------------------------------------------

const HAAL_BESTELLING_OP_NAAM = `
  query HaalBestellingOpNaam($query: String!) {
    orders(query: $query, first: 1) {
      nodes {
        ${ORDER_FIELDS}
      }
    }
  }
`;

/**
 * Haal een Shopify-bestelling op via naam en e-mailadres.
 * Retourneert null als geen bestelling gevonden of e-mailadres niet overeenkomt.
 *
 * @param orderName    - Bestelnummer, bijv. "#1042"
 * @param email        - E-mailadres van de klant (voor verificatie)
 */
export async function haalBestellingOpNaamEnEmail(
  orderName: string,
  email: string,
): Promise<ShopifyOrderUitgebreid | null> {
  // Normaliseer bestelnummer (voeg '#' toe als afwezig)
  const genormaliseerdNaam = orderName.startsWith("#")
    ? orderName
    : `#${orderName}`;

  const data = await shopifyAdmin<{
    orders: { nodes: ShopifyOrderApiResponse[] };
  }>(HAAL_BESTELLING_OP_NAAM, {
    query: `name:${genormaliseerdNaam}`,
  });

  const bestelling = data.orders.nodes[0];
  if (!bestelling) return null;

  // Verifieer e-mailadres (extra controle naast query)
  const bestellingEmail = bestelling.email?.toLowerCase() ??
    bestelling.customer?.email?.toLowerCase() ?? "";
  const gevraagdEmail = email.toLowerCase();

  if (bestellingEmail !== gevraagdEmail) {
    // E-mailadres komt niet overeen — return null voor veiligheid
    return null;
  }

  return mapeerBestellingNaarModel(bestelling);
}

// ---------------------------------------------------------------------------
// Mapping-functie
// ---------------------------------------------------------------------------

function mapeerBestellingNaarModel(
  bestelling: ShopifyOrderApiResponse,
): ShopifyOrderUitgebreid {
  const lineItems: ShopifyLineItemUitgebreid[] = bestelling.lineItems.nodes.map((item) => {
    const variantId = item.variant?.id ?? "";
    const productId = item.product?.id ?? "";
    const compareAtPrice = item.variant?.compareAtPrice ?? null;

    return {
      id: item.id,
      variantId,
      productId,
      productTitle: item.product?.title ?? "",
      variantTitle: item.variant?.title ?? null,
      sku: item.variant?.sku ?? null,
      productType: item.product?.productType ?? "",
      tags: item.product?.tags ?? [],
      quantity: item.quantity,
      originalUnitPrice:
        item.originalUnitPriceSet.shopMoney.amount,
      discountedUnitPrice:
        item.discountedUnitPriceSet.shopMoney.amount,
      compareAtPrice: compareAtPrice ?? null,
      metafields: item.product?.metafield
        ? [item.product.metafield]
        : [],
    };
  });

  return {
    id: bestelling.id,
    name: bestelling.name,
    customerEmail: bestelling.email ?? bestelling.customer?.email ?? "",
    customerId: bestelling.customer?.id ?? null,
    financialStatus: bestelling.financialStatus.toLowerCase(),
    fulfillmentStatus: mapeerFulfillmentStatus(
      bestelling.displayFulfillmentStatus,
    ),
    fulfillments: bestelling.fulfillments.map((f) => ({
      createdAt: f.createdAt,
      deliveredAt: f.deliveredAt ?? null,
    })),
    lineItems,
  };
}

/**
 * Zet Shopify displayFulfillmentStatus om naar de waarden die de eligibility-engine verwacht.
 */
function mapeerFulfillmentStatus(displayStatus: string): string {
  const lagere = displayStatus.toLowerCase();
  if (lagere === "fulfilled") return "fulfilled";
  if (lagere === "partial") return "partial";
  if (lagere === "in_transit") return "fulfilled"; // behandel als fulfilled voor eligibility
  return "unfulfilled";
}

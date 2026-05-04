/**
 * Gedeelde constanten — JANICE Returns & Exchanges app
 *
 * Centrale plek voor waarden die in meerdere modules worden gebruikt.
 * Bij een Shopify API-versie-upgrade: alleen SHOPIFY_API_VERSION aanpassen.
 */

// ---------------------------------------------------------------------------
// Shopify API-versie
// ---------------------------------------------------------------------------

/**
 * Shopify Admin API-versie die in de hele applicatie wordt gebruikt.
 * Shopify brengt elk kwartaal een nieuwe versie uit. Bij een upgrade hier
 * aanpassen en de CI-pipeline zal alle callsites automatisch meenemen.
 *
 * Huidige versie: 2025-01 (ondersteund t/m januari 2026)
 * @see https://shopify.dev/docs/api/usage/versioning
 */
export const SHOPIFY_API_VERSION = "2025-01" as const;

/**
 * Bouw de basis-URL voor Shopify Admin REST-endpoints.
 *
 * @param shop - Shopify shop-domein, bijv. "u17s8e-sc.myshopify.com"
 * @returns    Base-URL inclusief API-versie
 *
 * @example
 * ```ts
 * const base = SHOPIFY_API_BASE("u17s8e-sc.myshopify.com");
 * // => "https://u17s8e-sc.myshopify.com/admin/api/2025-01"
 * ```
 */
export const SHOPIFY_API_BASE = (shop: string): string =>
  `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`;

/**
 * Bouw de Shopify Admin GraphQL-endpoint URL.
 *
 * @param shop - Shopify shop-domein, bijv. "u17s8e-sc.myshopify.com"
 * @returns    Volledige GraphQL-endpoint URL
 *
 * @example
 * ```ts
 * const url = SHOPIFY_GRAPHQL_URL("u17s8e-sc.myshopify.com");
 * // => "https://u17s8e-sc.myshopify.com/admin/api/2025-01/graphql.json"
 * ```
 */
export const SHOPIFY_GRAPHQL_URL = (shop: string): string =>
  `${SHOPIFY_API_BASE(shop)}/graphql.json`;

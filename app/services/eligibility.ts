/**
 * Retourgeschiktheidscontrole — JANICE Returns & Exchanges app — PR #2
 *
 * Controleert of een klant een of meer line items mag retourneren.
 * De controle bestaat uit 6 onafhankelijke regels die elk afzonderlijk
 * te testen zijn. De caller is verantwoordelijk voor het ophalen van de
 * Shopify-bestelling — geen live API-aanroepen in dit bestand (PR #3).
 *
 * Regels (in volgorde van uitvoering):
 *  1. Bestelstatus: betaald én fulfilled
 *  2. Retourvenster: 30 dagen (< 30% korting) of 14 dagen (≥ 30% korting)
 *  3. Final-sale: product.metafields.custom.is_final_sale == true
 *  4. Hygiënecategorie: zwemkleding, ondergoed, oorbellen, cosmetica
 *  5. Duplicaatretour: al een lopende retour op hetzelfde line item
 *  6. Hoeveelheid: gevraagde qty ≤ originele qty minus al geretourneerde qty
 *
 * Alle datumberekeningen via dayjs — geen native Date rekensom.
 * Geen floating-point geldbedragen — Decimal.js voor kortingsberekening.
 */

import dayjs from "dayjs";
import Decimal from "decimal.js";
import * as Sentry from "@sentry/node";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { returnItems } from "../../db/schema.js";

// ---------------------------------------------------------------------------
// Shopify-typen (PR #3 levert de echte GQL-typen; hier minimale interface)
// ---------------------------------------------------------------------------

export interface ShopifyFulfillment {
  createdAt: string; // ISO-8601
  deliveredAt?: string | null; // ISO-8601 (optioneel — niet altijd bekend)
}

export interface ShopifyLineItemMetafield {
  namespace: string;
  key: string;
  value: string;
}

export interface ShopifyLineItem {
  id: string; // Shopify GID
  variantId: string;
  productId: string;
  productTitle: string;
  productType: string;
  tags: string[];
  quantity: number;
  originalUnitPrice: string; // Decimaal als string (Shopify-conventie)
  discountedUnitPrice: string; // Decimaal als string
  compareAtPrice?: string | null;
  /** Metafields van het product, specifiek custom.is_final_sale */
  metafields?: ShopifyLineItemMetafield[];
}

export interface ShopifyOrder {
  id: string; // Shopify GID
  name: string; // "#1042"
  financialStatus: string; // "paid" | "partially_paid" | etc.
  fulfillmentStatus: string; // "fulfilled" | "partial" | "unfulfilled"
  fulfillments: ShopifyFulfillment[];
  lineItems: ShopifyLineItem[];
}

// ---------------------------------------------------------------------------
// Retourgeschiktheidsresultaat
// ---------------------------------------------------------------------------

export interface EligibilityResult {
  /** True als alle controles geslaagd zijn */
  eligible: boolean;
  /**
   * i18n-sleutels voor elke reden van ongeschiktheid.
   * Leeg als eligible=true. Display-tekst leeft in de UI, niet hier.
   */
  reasons: string[];
  /**
   * Retourvenster in dagen (30 of 14).
   * Gebaseerd op het item met de hoogste korting in de selectie.
   */
  windowDays: number;
  /** Vervaldatum van het retourvenster — null als niet bepaalbaar */
  windowExpiresAt: Date | null;
}

// ---------------------------------------------------------------------------
// Configuratie
// ---------------------------------------------------------------------------

/** Retourvenster voor items met < 30% korting */
const VENSTER_VOLLEDIG_PRIJS_DAGEN = 30;

/** Retourvenster voor items met ≥ 30% korting (sale) */
const VENSTER_SALE_DAGEN = 14;

/** Kortingsdrempel waarboven het kortere venster geldt */
const SALE_DREMPEL_PROCENT = 30;

/** Hygiënecategorieën die niet retourneerbaar zijn */
const HYGIENE_CATEGORIEEN: ReadonlySet<string> = new Set([
  "swimwear",
  "underwear",
  "earrings",
  "cosmetics",
  // Nederlandstalige alternatieven voor robuustheid
  "zwemkleding",
  "ondergoed",
  "oorbellen",
  "cosmetica",
]);

/** Terminal states waarbinnen een dupicaatretour geblokkeerd wordt */
const NIET_TERMINAL_STATES = ["DRAFT", "SUBMITTED", "APPROVED", "LABEL_ISSUED", "IN_TRANSIT", "RECEIVED", "INSPECTING"];

// ---------------------------------------------------------------------------
// Invoervalidatie
// ---------------------------------------------------------------------------

const EligibilityInputSchema = z.object({
  shopifyOrder: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    financialStatus: z.string().min(1),
    fulfillmentStatus: z.string().min(1),
    fulfillments: z.array(
      z.object({
        createdAt: z.string().min(1),
        deliveredAt: z.string().nullable().optional(),
      }),
    ),
    lineItems: z.array(z.object({
      id: z.string().min(1),
      variantId: z.string().min(1),
      productId: z.string().min(1),
      productTitle: z.string(),
      productType: z.string(),
      tags: z.array(z.string()),
      quantity: z.number().int().positive(),
      originalUnitPrice: z.string(),
      discountedUnitPrice: z.string(),
      compareAtPrice: z.string().nullable().optional(),
      metafields: z.array(z.object({
        namespace: z.string(),
        key: z.string(),
        value: z.string(),
      })).optional(),
    })),
  }),
  lineItemIds: z.array(z.string().min(1)).min(1, "Minimaal één line item vereist"),
  requestedQuantities: z.record(z.string(), z.number().int().positive()).optional(),
});

export type EligibilityInput = z.infer<typeof EligibilityInputSchema>;

// ---------------------------------------------------------------------------
// Individuele regelimplementaties
// ---------------------------------------------------------------------------

/**
 * Regel 1: Bestelstatus
 * De bestelling moet betaald én fulfilled zijn.
 */
export function controleerBestelstatus(
  order: ShopifyOrder,
): { geslaagd: boolean; reden?: string } {
  const isPaid =
    order.financialStatus === "paid" ||
    order.financialStatus === "partially_paid";
  const isFulfilled =
    order.fulfillmentStatus === "fulfilled" ||
    order.fulfillmentStatus === "partial";

  if (!isPaid || !isFulfilled) {
    return { geslaagd: false, reden: "order_not_fulfilled" };
  }
  return { geslaagd: true };
}

/**
 * Regel 2: Retourvenster
 * Berekent het venster op basis van de hoogste korting in de selectie.
 * Datum-startpunt: deliveredAt indien beschikbaar, anders fulfillment.createdAt.
 *
 * @returns windowDays, windowExpiresAt, en of het venster verlopen is
 */
export function controleerRetourvenster(
  order: ShopifyOrder,
  lineItems: ShopifyLineItem[],
): {
  geslaagd: boolean;
  reden?: string;
  windowDays: number;
  windowExpiresAt: Date | null;
} {
  // Bepaal de startdatum op basis van de meest recente fulfillment
  const fulfillmentDatums = order.fulfillments
    .map((f) => f.deliveredAt ?? f.createdAt)
    .filter(Boolean);

  if (fulfillmentDatums.length === 0) {
    // Geen fulfillment-datum beschikbaar — venster onbekend, blokkeer veiligheidshalve
    return {
      geslaagd: false,
      reden: "order_not_fulfilled",
      windowDays: VENSTER_VOLLEDIG_PRIJS_DAGEN,
      windowExpiresAt: null,
    };
  }

  // Gebruik de vroegste fulfillment-datum als startpunt
  const vroegsteDatum = fulfillmentDatums
    .map((d) => dayjs(d))
    .reduce((vroegst, huidig) => (huidig.isBefore(vroegst) ? huidig : vroegst));

  // Bepaal maximale kortingspercentage over alle geselecteerde items
  const maximaleKorting = lineItems.reduce((max, item) => {
    const korting = berekenKortingsProcent(item);
    return korting > max ? korting : max;
  }, 0);

  const windowDays =
    maximaleKorting >= SALE_DREMPEL_PROCENT
      ? VENSTER_SALE_DAGEN
      : VENSTER_VOLLEDIG_PRIJS_DAGEN;

  const windowExpiresAt = vroegsteDatum.add(windowDays, "day").toDate();
  const nuIsNa = dayjs().isAfter(dayjs(windowExpiresAt));

  if (nuIsNa) {
    return {
      geslaagd: false,
      reden: "return_window_expired",
      windowDays,
      windowExpiresAt,
    };
  }

  return { geslaagd: true, windowDays, windowExpiresAt };
}

/**
 * Regel 3: Final-sale controle
 * Line items met product.metafields.custom.is_final_sale == "true" zijn
 * niet retourneerbaar.
 */
export function controleerFinalSale(
  lineItems: ShopifyLineItem[],
): { geslaagd: boolean; reden?: string } {
  for (const item of lineItems) {
    const isFinalSale = item.metafields?.some(
      (mf) =>
        mf.namespace === "custom" &&
        mf.key === "is_final_sale" &&
        mf.value === "true",
    );
    if (isFinalSale) {
      return { geslaagd: false, reden: "final_sale_not_returnable" };
    }
  }
  return { geslaagd: true };
}

/**
 * Regel 4: Hygiënecategorie
 * Producttypes en tags worden gecheckt op hygiënecategorieën.
 * Case-insensitief.
 */
export function controleerHygienecategorie(
  lineItems: ShopifyLineItem[],
): { geslaagd: boolean; reden?: string } {
  for (const item of lineItems) {
    const productTypeLower = item.productType.toLowerCase().trim();
    if (HYGIENE_CATEGORIEEN.has(productTypeLower)) {
      return { geslaagd: false, reden: "hygiene_category_not_returnable" };
    }

    // Controleer ook tags
    const heeftHygieneTag = item.tags.some((tag) =>
      HYGIENE_CATEGORIEEN.has(tag.toLowerCase().trim()),
    );
    if (heeftHygieneTag) {
      return { geslaagd: false, reden: "hygiene_category_not_returnable" };
    }
  }
  return { geslaagd: true };
}

/**
 * Regel 5: Duplicaatretourdetectie
 * Checkt of er al een actief (niet-terminal-rejected) retourverzoek bestaat
 * voor de opgegeven Shopify line item IDs.
 */
export async function controleerDuplicaatretour(
  shopifyLineItemIds: string[],
): Promise<{ geslaagd: boolean; reden?: string }> {
  if (shopifyLineItemIds.length === 0) {
    return { geslaagd: true };
  }

  // Controleer op bestaande return_items voor de opgegeven line item IDs.
  // Als er al items bestaan (ongeacht state), blokkeer dan nieuwe retour.
  // State-filtering (alleen actieve states) vindt plaats in PR #3 via join op returns.state.
  const bestaande = await db
    .select({ id: returnItems.id })
    .from(returnItems)
    .where(
      inArray(returnItems.shopifyLineItemId, shopifyLineItemIds),
    );

  if (bestaande.length > 0) {
    return { geslaagd: false, reden: "already_returning_this_line" };
  }

  return { geslaagd: true };
}

/**
 * Regel 6: Hoeveelheidscontrole
 * Gevraagde retourhoeveelheid per line item ≤ originele qty minus al
 * geretourneerde qty.
 *
 * @param requestedQuantities - Map van shopify_line_item_id → gevraagde qty
 */
export async function controleerHoeveelheid(
  lineItems: ShopifyLineItem[],
  requestedQuantities: Record<string, number>,
): Promise<{ geslaagd: boolean; reden?: string }> {
  for (const item of lineItems) {
    const gevraagtQty = requestedQuantities[item.id] ?? 1;
    const origineelQty = item.quantity;

    // Tel al geretourneerde hoeveelheden voor dit line item
    const alGeretourneerd = await db
      .select({ quantity: returnItems.quantity })
      .from(returnItems)
      .where(eq(returnItems.shopifyLineItemId, item.id));

    const totaalAlGeretourneerd = alGeretourneerd.reduce(
      (sum, r) => sum + r.quantity,
      0,
    );

    const beschikbaarQty = origineelQty - totaalAlGeretourneerd;

    if (gevraagtQty > beschikbaarQty) {
      return {
        geslaagd: false,
        reden: "quantity_exceeds_returnable",
      };
    }
  }

  return { geslaagd: true };
}

// ---------------------------------------------------------------------------
// Hoofd-functie: checkEligibility
// ---------------------------------------------------------------------------

/**
 * Controleer of de opgegeven line items retourneerbaar zijn.
 *
 * De caller is verantwoordelijk voor het ophalen van de ShopifyOrder.
 * Geen live Shopify API-aanroepen in deze functie (PR #3).
 *
 * @example
 * const result = await checkEligibility({
 *   shopifyOrder: fetchedOrder,
 *   lineItemIds: ["gid://shopify/LineItem/123"],
 *   requestedQuantities: { "gid://shopify/LineItem/123": 1 },
 * });
 * if (!result.eligible) console.log(result.reasons);
 */
export async function checkEligibility(
  input: EligibilityInput,
): Promise<EligibilityResult> {
  // Valideer invoer
  const gevalideerd = EligibilityInputSchema.parse(input);

  return Sentry.startSpan(
    {
      op: "returns.eligibility.check",
      name: "retourgeschiktheidscontrole",
      attributes: {
        "order.id": gevalideerd.shopifyOrder.id,
        "line_items.count": gevalideerd.lineItemIds.length,
      },
    },
    async () => {
      const redenen: string[] = [];
      let windowDays = VENSTER_VOLLEDIG_PRIJS_DAGEN;
      let windowExpiresAt: Date | null = null;

      // Filter de geselecteerde line items uit de bestelling
      const geselecteerdeItems = gevalideerd.shopifyOrder.lineItems.filter(
        (item) => gevalideerd.lineItemIds.includes(item.id),
      );

      // Regel 1: Bestelstatus
      const statusResultaat = controleerBestelstatus(gevalideerd.shopifyOrder);
      if (!statusResultaat.geslaagd && statusResultaat.reden) {
        redenen.push(statusResultaat.reden);
      }

      // Regel 2: Retourvenster (altijd berekenen voor windowDays/windowExpiresAt)
      const vensterResultaat = controleerRetourvenster(
        gevalideerd.shopifyOrder,
        geselecteerdeItems,
      );
      windowDays = vensterResultaat.windowDays;
      windowExpiresAt = vensterResultaat.windowExpiresAt;
      if (!vensterResultaat.geslaagd && vensterResultaat.reden) {
        redenen.push(vensterResultaat.reden);
      }

      // Regel 3: Final-sale
      const finalSaleResultaat = controleerFinalSale(geselecteerdeItems);
      if (!finalSaleResultaat.geslaagd && finalSaleResultaat.reden) {
        redenen.push(finalSaleResultaat.reden);
      }

      // Regel 4: Hygiënecategorie
      const hygieneResultaat = controleerHygienecategorie(geselecteerdeItems);
      if (!hygieneResultaat.geslaagd && hygieneResultaat.reden) {
        redenen.push(hygieneResultaat.reden);
      }

      // Regel 5: Duplicaatretour
      const duplicaatResultaat = await controleerDuplicaatretour(
        gevalideerd.lineItemIds,
      );
      if (!duplicaatResultaat.geslaagd && duplicaatResultaat.reden) {
        redenen.push(duplicaatResultaat.reden);
      }

      // Regel 6: Hoeveelheid
      const hoeveelheidResultaat = await controleerHoeveelheid(
        geselecteerdeItems,
        gevalideerd.requestedQuantities ?? {},
      );
      if (!hoeveelheidResultaat.geslaagd && hoeveelheidResultaat.reden) {
        redenen.push(hoeveelheidResultaat.reden);
      }

      return {
        eligible: redenen.length === 0,
        reasons: redenen,
        windowDays,
        windowExpiresAt,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

/**
 * Bereken het kortingspercentage voor een line item.
 * Gebruikt Decimal.js voor nauwkeurige berekening.
 * Geeft 0 terug als er geen vergelijkingsprijs beschikbaar is.
 */
export function berekenKortingsProcent(item: ShopifyLineItem): number {
  if (!item.compareAtPrice) return 0;

  const compareAt = new Decimal(item.compareAtPrice);
  const betaald = new Decimal(item.discountedUnitPrice);

  if (compareAt.isZero() || compareAt.lessThan(betaald)) return 0;

  return compareAt
    .minus(betaald)
    .dividedBy(compareAt)
    .times(100)
    .toDecimalPlaces(2)
    .toNumber();
}

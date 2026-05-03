/**
 * Tests voor eligibility.ts — JANICE Returns & Exchanges app
 *
 * Dekt alle 6 regels in isolatie plus gecombineerde scenario's.
 * Alle DB-aanroepen worden gemockt via vi.hoisted om hoisting-problemen te vermijden.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  controleerBestelstatus,
  controleerRetourvenster,
  controleerFinalSale,
  controleerHygienecategorie,
  controleerDuplicaatretour,
  controleerHoeveelheid,
  checkEligibility,
  berekenKortingsProcent,
  type ShopifyOrder,
  type ShopifyLineItem,
  type EligibilityInput,
} from "./eligibility.js";

// ---------------------------------------------------------------------------
// DB mock via vi.hoisted — voorkomt hoisting-problemen
// ---------------------------------------------------------------------------

const { mockDbSelectResult, mockDbSelectFn } = vi.hoisted(() => {
  const mockDbSelectResult = vi.fn().mockResolvedValue([]);
  const mockDbSelectFn = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => mockDbSelectResult()),
    })),
  }));
  return { mockDbSelectResult, mockDbSelectFn };
});

vi.mock("../../db/index.js", () => ({
  db: {
    select: mockDbSelectFn,
  },
}));

vi.mock("../../db/schema.js", () => ({
  returnItems: {
    id: "id",
    returnId: "return_id",
    shopifyLineItemId: "shopify_line_item_id",
    quantity: "quantity",
  },
}));

vi.mock("@sentry/node", () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function maakLineItem(overschrijvingen: Partial<ShopifyLineItem> = {}): ShopifyLineItem {
  return {
    id: "gid://shopify/LineItem/111",
    variantId: "gid://shopify/ProductVariant/222",
    productId: "gid://shopify/Product/333",
    productTitle: "JANICE Linen Blazer",
    productType: "blazer",
    tags: [],
    quantity: 1,
    originalUnitPrice: "199.95",
    discountedUnitPrice: "199.95",
    compareAtPrice: null,
    metafields: [],
    ...overschrijvingen,
  };
}

function maakOrder(overschrijvingen: Partial<ShopifyOrder> = {}): ShopifyOrder {
  return {
    id: "gid://shopify/Order/12345",
    name: "#1042",
    financialStatus: "paid",
    fulfillmentStatus: "fulfilled",
    fulfillments: [
      {
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        deliveredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    lineItems: [maakLineItem()],
    ...overschrijvingen,
  };
}

// ---------------------------------------------------------------------------
// Regel 1: Bestelstatus
// ---------------------------------------------------------------------------

describe("controleerBestelstatus()", () => {
  it("slaagt bij status paid + fulfilled", () => {
    const order = maakOrder({ financialStatus: "paid", fulfillmentStatus: "fulfilled" });
    expect(controleerBestelstatus(order).geslaagd).toBe(true);
  });

  it("slaagt bij status partially_paid + fulfilled", () => {
    const order = maakOrder({ financialStatus: "partially_paid", fulfillmentStatus: "fulfilled" });
    expect(controleerBestelstatus(order).geslaagd).toBe(true);
  });

  it("slaagt bij paid + partial fulfillment", () => {
    const order = maakOrder({ financialStatus: "paid", fulfillmentStatus: "partial" });
    expect(controleerBestelstatus(order).geslaagd).toBe(true);
  });

  it("faalt bij onbetaalde bestelling", () => {
    const order = maakOrder({ financialStatus: "pending", fulfillmentStatus: "fulfilled" });
    const resultaat = controleerBestelstatus(order);
    expect(resultaat.geslaagd).toBe(false);
    expect(resultaat.reden).toBe("order_not_fulfilled");
  });

  it("faalt bij niet-fulfilled bestelling", () => {
    const order = maakOrder({ financialStatus: "paid", fulfillmentStatus: "unfulfilled" });
    const resultaat = controleerBestelstatus(order);
    expect(resultaat.geslaagd).toBe(false);
    expect(resultaat.reden).toBe("order_not_fulfilled");
  });

  it("faalt bij refunded status", () => {
    const order = maakOrder({ financialStatus: "refunded", fulfillmentStatus: "fulfilled" });
    const resultaat = controleerBestelstatus(order);
    expect(resultaat.geslaagd).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regel 2: Retourvenster
// ---------------------------------------------------------------------------

describe("controleerRetourvenster()", () => {
  it("slaagt bij volledig-prijs artikel binnen 30-dagenvenster", () => {
    const order = maakOrder({
      fulfillments: [{
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        deliveredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      }],
    });
    const item = maakLineItem({ discountedUnitPrice: "199.95", compareAtPrice: null });

    const resultaat = controleerRetourvenster(order, [item]);

    expect(resultaat.geslaagd).toBe(true);
    expect(resultaat.windowDays).toBe(30);
    expect(resultaat.windowExpiresAt).toBeInstanceOf(Date);
  });

  it("geeft 14 dagen venster bij ≥ 30% korting", () => {
    const order = maakOrder({
      fulfillments: [{
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      }],
    });
    const item = maakLineItem({
      discountedUnitPrice: "49.95",
      compareAtPrice: "79.95",
    });

    const resultaat = controleerRetourvenster(order, [item]);

    expect(resultaat.windowDays).toBe(14);
    expect(resultaat.geslaagd).toBe(true);
  });

  it("geeft 30 dagen venster bij < 30% korting", () => {
    const order = maakOrder();
    const item = maakLineItem({
      discountedUnitPrice: "69.95",
      compareAtPrice: "79.95", // ~12.5% korting
    });

    const resultaat = controleerRetourvenster(order, [item]);

    expect(resultaat.windowDays).toBe(30);
  });

  it("faalt wanneer venster van 30 dagen verlopen is", () => {
    const order = maakOrder({
      fulfillments: [{
        createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        deliveredAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString(),
      }],
    });
    const item = maakLineItem();

    const resultaat = controleerRetourvenster(order, [item]);

    expect(resultaat.geslaagd).toBe(false);
    expect(resultaat.reden).toBe("return_window_expired");
    expect(resultaat.windowDays).toBe(30);
  });

  it("faalt wanneer 14-dagenvenster verlopen is (sale-artikel)", () => {
    const order = maakOrder({
      fulfillments: [{
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
        deliveredAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString(),
      }],
    });
    const item = maakLineItem({
      discountedUnitPrice: "39.95",
      compareAtPrice: "79.95",
    });

    const resultaat = controleerRetourvenster(order, [item]);

    expect(resultaat.geslaagd).toBe(false);
    expect(resultaat.reden).toBe("return_window_expired");
    expect(resultaat.windowDays).toBe(14);
  });

  it("faalt als er geen fulfillment-datum beschikbaar is", () => {
    const order = maakOrder({ fulfillments: [] });
    const item = maakLineItem();

    const resultaat = controleerRetourvenster(order, [item]);

    expect(resultaat.geslaagd).toBe(false);
    expect(resultaat.windowExpiresAt).toBeNull();
  });

  it("gemengd mandje: neemt het kortste venster (hoogste korting bepaalt)", () => {
    const order = maakOrder();
    const volledigPrijsItem = maakLineItem({ compareAtPrice: null });
    const saleItem = maakLineItem({
      id: "gid://shopify/LineItem/999",
      discountedUnitPrice: "39.95",
      compareAtPrice: "79.95",
    });

    const resultaat = controleerRetourvenster(order, [volledigPrijsItem, saleItem]);

    expect(resultaat.windowDays).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Regel 3: Final-sale
// ---------------------------------------------------------------------------

describe("controleerFinalSale()", () => {
  it("slaagt als geen enkel item final-sale is", () => {
    const item = maakLineItem({ metafields: [] });
    expect(controleerFinalSale([item]).geslaagd).toBe(true);
  });

  it("faalt als item metafield custom.is_final_sale=true heeft", () => {
    const item = maakLineItem({
      metafields: [{ namespace: "custom", key: "is_final_sale", value: "true" }],
    });
    const resultaat = controleerFinalSale([item]);
    expect(resultaat.geslaagd).toBe(false);
    expect(resultaat.reden).toBe("final_sale_not_returnable");
  });

  it("slaagt als metafield waarde 'false' is", () => {
    const item = maakLineItem({
      metafields: [{ namespace: "custom", key: "is_final_sale", value: "false" }],
    });
    expect(controleerFinalSale([item]).geslaagd).toBe(true);
  });

  it("faalt als één item in de selectie final-sale is", () => {
    const normaalItem = maakLineItem();
    const finalSaleItem = maakLineItem({
      id: "gid://shopify/LineItem/999",
      metafields: [{ namespace: "custom", key: "is_final_sale", value: "true" }],
    });
    const resultaat = controleerFinalSale([normaalItem, finalSaleItem]);
    expect(resultaat.geslaagd).toBe(false);
  });

  it("slaagt als metafields undefined zijn (null-safe)", () => {
    const item = maakLineItem({ metafields: undefined });
    expect(controleerFinalSale([item]).geslaagd).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regel 4: Hygiënecategorie
// ---------------------------------------------------------------------------

describe("controleerHygienecategorie()", () => {
  it("slaagt bij normale kledingcategorie", () => {
    const item = maakLineItem({ productType: "blazer" });
    expect(controleerHygienecategorie([item]).geslaagd).toBe(true);
  });

  it("faalt bij productType swimwear", () => {
    const item = maakLineItem({ productType: "swimwear" });
    const resultaat = controleerHygienecategorie([item]);
    expect(resultaat.geslaagd).toBe(false);
    expect(resultaat.reden).toBe("hygiene_category_not_returnable");
  });

  it("faalt bij productType underwear", () => {
    const item = maakLineItem({ productType: "underwear" });
    expect(controleerHygienecategorie([item]).geslaagd).toBe(false);
  });

  it("faalt bij productType earrings", () => {
    const item = maakLineItem({ productType: "earrings" });
    expect(controleerHygienecategorie([item]).geslaagd).toBe(false);
  });

  it("faalt bij productType cosmetics", () => {
    const item = maakLineItem({ productType: "cosmetics" });
    expect(controleerHygienecategorie([item]).geslaagd).toBe(false);
  });

  it("faalt bij hygiëne-tag (case-insensitief)", () => {
    const item = maakLineItem({
      productType: "fashion",
      tags: ["summer", "SWIMWEAR", "trending"],
    });
    const resultaat = controleerHygienecategorie([item]);
    expect(resultaat.geslaagd).toBe(false);
  });

  it("is case-insensitief voor productType", () => {
    const item = maakLineItem({ productType: "UNDERWEAR" });
    expect(controleerHygienecategorie([item]).geslaagd).toBe(false);
  });

  it("Nederlandse categorienamen worden ook geblokkeerd", () => {
    const item = maakLineItem({ productType: "zwemkleding" });
    expect(controleerHygienecategorie([item]).geslaagd).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regel 5: Duplicaatretour (async, DB-mock)
// ---------------------------------------------------------------------------

describe("controleerDuplicaatretour()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelectFn.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    });
  });

  it("slaagt als er geen bestaande retouritems zijn", async () => {
    mockDbSelectFn.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    });

    const resultaat = await controleerDuplicaatretour([
      "gid://shopify/LineItem/111",
    ]);

    expect(resultaat.geslaagd).toBe(true);
  });

  it("faalt als er al een retouritem bestaat voor dit line item", async () => {
    mockDbSelectFn.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ id: "bestaand_item_001" }])),
      })),
    });

    const resultaat = await controleerDuplicaatretour([
      "gid://shopify/LineItem/111",
    ]);

    expect(resultaat.geslaagd).toBe(false);
    expect(resultaat.reden).toBe("already_returning_this_line");
  });

  it("slaagt bij lege lineItemIds-array", async () => {
    const resultaat = await controleerDuplicaatretour([]);
    expect(resultaat.geslaagd).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regel 6: Hoeveelheid (async, DB-mock)
// ---------------------------------------------------------------------------

describe("controleerHoeveelheid()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("slaagt als gevraagde qty ≤ originele qty", async () => {
    mockDbSelectFn.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    });

    const item = maakLineItem({ quantity: 3 });
    const resultaat = await controleerHoeveelheid(
      [item],
      { "gid://shopify/LineItem/111": 2 },
    );

    expect(resultaat.geslaagd).toBe(true);
  });

  it("faalt als gevraagde qty > beschikbare qty", async () => {
    // 1 al geretourneerd van 2 totaal
    mockDbSelectFn.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ quantity: 1 }])),
      })),
    });

    const item = maakLineItem({ quantity: 2 });
    const resultaat = await controleerHoeveelheid(
      [item],
      { "gid://shopify/LineItem/111": 2 },
    );

    expect(resultaat.geslaagd).toBe(false);
    expect(resultaat.reden).toBe("quantity_exceeds_returnable");
  });

  it("slaagt bij gedeeltelijke retour na eerdere deelretour", async () => {
    // 1 van 3 al geretourneerd
    mockDbSelectFn.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ quantity: 1 }])),
      })),
    });

    const item = maakLineItem({ quantity: 3 });
    const resultaat = await controleerHoeveelheid(
      [item],
      { "gid://shopify/LineItem/111": 1 },
    );

    expect(resultaat.geslaagd).toBe(true);
  });

  it("gebruikt standaard qty=1 als niet opgegeven", async () => {
    mockDbSelectFn.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    });

    const item = maakLineItem({ quantity: 1 });
    const resultaat = await controleerHoeveelheid([item], {});

    expect(resultaat.geslaagd).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// berekenKortingsProcent() hulpfunctie
// ---------------------------------------------------------------------------

describe("berekenKortingsProcent()", () => {
  it("geeft 0 terug als compareAtPrice null is", () => {
    const item = maakLineItem({ compareAtPrice: null });
    expect(berekenKortingsProcent(item)).toBe(0);
  });

  it("berekent korting correct bij ~50%", () => {
    const item = maakLineItem({
      discountedUnitPrice: "39.95",
      compareAtPrice: "79.90",
    });
    const korting = berekenKortingsProcent(item);
    expect(korting).toBeGreaterThan(49);
    expect(korting).toBeLessThan(51);
  });

  it("geeft 0 terug als compareAtPrice < discountedUnitPrice (corrupt)", () => {
    const item = maakLineItem({
      discountedUnitPrice: "99.95",
      compareAtPrice: "79.95",
    });
    expect(berekenKortingsProcent(item)).toBe(0);
  });

  it("geeft 0 terug als compareAtPrice gelijk is aan discountedUnitPrice", () => {
    const item = maakLineItem({
      discountedUnitPrice: "79.95",
      compareAtPrice: "79.95",
    });
    expect(berekenKortingsProcent(item)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkEligibility() — gecombineerde scenario's
// ---------------------------------------------------------------------------

describe("checkEligibility()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Standaard: geen bestaande retouritems
    mockDbSelectFn.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    });
  });

  function maakEligibilityInput(
    overschrijvingen: Partial<EligibilityInput> = {},
  ): EligibilityInput {
    const lineItem = maakLineItem();
    return {
      shopifyOrder: maakOrder({ lineItems: [lineItem] }),
      lineItemIds: [lineItem.id],
      requestedQuantities: { [lineItem.id]: 1 },
      ...overschrijvingen,
    };
  }

  it("eligible=true bij volledig-prijs artikel binnen retourvenster", async () => {
    const resultaat = await checkEligibility(maakEligibilityInput());

    expect(resultaat.eligible).toBe(true);
    expect(resultaat.reasons).toHaveLength(0);
    expect(resultaat.windowDays).toBe(30);
    expect(resultaat.windowExpiresAt).toBeInstanceOf(Date);
  });

  it("eligible=false bij verlopen retourvenster van sale-artikel", async () => {
    const saleItem = maakLineItem({
      discountedUnitPrice: "39.95",
      compareAtPrice: "79.95",
    });
    const order = maakOrder({
      lineItems: [saleItem],
      fulfillments: [{
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
        deliveredAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString(),
      }],
    });

    const resultaat = await checkEligibility({
      shopifyOrder: order,
      lineItemIds: [saleItem.id],
    });

    expect(resultaat.eligible).toBe(false);
    expect(resultaat.reasons).toContain("return_window_expired");
    expect(resultaat.windowDays).toBe(14);
  });

  it("eligible=false bij final-sale artikel", async () => {
    const finalSaleItem = maakLineItem({
      metafields: [{ namespace: "custom", key: "is_final_sale", value: "true" }],
    });
    const order = maakOrder({ lineItems: [finalSaleItem] });

    const resultaat = await checkEligibility({
      shopifyOrder: order,
      lineItemIds: [finalSaleItem.id],
    });

    expect(resultaat.eligible).toBe(false);
    expect(resultaat.reasons).toContain("final_sale_not_returnable");
  });

  it("eligible=false bij hygiënecategorie", async () => {
    const swimwearItem = maakLineItem({ productType: "swimwear" });
    const order = maakOrder({ lineItems: [swimwearItem] });

    const resultaat = await checkEligibility({
      shopifyOrder: order,
      lineItemIds: [swimwearItem.id],
    });

    expect(resultaat.eligible).toBe(false);
    expect(resultaat.reasons).toContain("hygiene_category_not_returnable");
  });

  it("eligible=false bij onbetaalde/niet-fulfilled bestelling", async () => {
    const order = maakOrder({
      financialStatus: "pending",
      fulfillmentStatus: "unfulfilled",
    });

    const resultaat = await checkEligibility({
      shopifyOrder: order,
      lineItemIds: [order.lineItems[0]!.id],
    });

    expect(resultaat.eligible).toBe(false);
    expect(resultaat.reasons).toContain("order_not_fulfilled");
  });

  it("eligible=false bij duplicaat retour", async () => {
    // Simuleer bestaand retouritem
    mockDbSelectFn.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ id: "bestaand_001" }])),
      })),
    });

    const resultaat = await checkEligibility(maakEligibilityInput());

    expect(resultaat.eligible).toBe(false);
    expect(resultaat.reasons).toContain("already_returning_this_line");
  });

  it("meerdere redenen worden allemaal gerapporteerd", async () => {
    // Final-sale én hygiënecategorie
    const item = maakLineItem({
      productType: "swimwear",
      metafields: [{ namespace: "custom", key: "is_final_sale", value: "true" }],
    });
    const order = maakOrder({ lineItems: [item] });

    const resultaat = await checkEligibility({
      shopifyOrder: order,
      lineItemIds: [item.id],
    });

    expect(resultaat.eligible).toBe(false);
    expect(resultaat.reasons).toContain("final_sale_not_returnable");
    expect(resultaat.reasons).toContain("hygiene_category_not_returnable");
  });

  it("gooit ZodError bij ontbrekende lineItemIds", async () => {
    const { ZodError } = await import("zod");

    await expect(
      checkEligibility({
        shopifyOrder: maakOrder(),
        lineItemIds: [], // Leeg — minimaal 1 vereist
      }),
    ).rejects.toThrow(ZodError);
  });
});

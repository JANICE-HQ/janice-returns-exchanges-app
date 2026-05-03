/**
 * Tests voor refund-calculator.ts — JANICE Returns & Exchanges app
 *
 * Dekt alle edge cases conform PR #2-specificatie:
 *  - compare_at_price null → refund = price × qty
 *  - compare_at_price > price → korting → refund = betaalde prijs × qty
 *  - compare_at_price < price (corrupt) → terugval naar betaalde prijs
 *  - compare_at_price == price → geen korting
 *  - Gemengd winkelmandje: items onafhankelijk berekend
 *  - Gedeeltelijke retour (qty < gekochte qty)
 *  - final-sale guard gooit FinalSaleGuardError
 *  - qty=0 grensgeval (Zod blokkering)
 *  - computeTotalRefund() over meerdere items
 */

import { describe, it, expect } from "vitest";
import {
  computeLineRefund,
  computeTotalRefund,
  FinalSaleGuardError,
  type ReturnLineItem,
} from "./refund-calculator.js";

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function maakRetourItem(overschrijvingen: Partial<ReturnLineItem> = {}): ReturnLineItem {
  return {
    shopifyLineItemId: "gid://shopify/LineItem/111",
    productTitle: "JANICE Linen Blazer",
    unitPrice: "199.95",
    unitCompareAtPrice: null,
    returnQuantity: 1,
    isFinalSale: false,
    ...overschrijvingen,
  };
}

// ---------------------------------------------------------------------------
// computeLineRefund() — individuele line items
// ---------------------------------------------------------------------------

describe("computeLineRefund()", () => {
  // -- Scenario 1: Geen compare_at_price --

  it("berekent refund = unitPrice × qty als compare_at_price null is", () => {
    const item = maakRetourItem({
      unitPrice: "199.95",
      unitCompareAtPrice: null,
      returnQuantity: 1,
    });

    const resultaat = computeLineRefund(item);

    expect(resultaat.refundAmount).toBe("199.95");
    expect(resultaat.discountPercentage).toBe("0.00");
    expect(resultaat.appliedRule).toBe("no_discount");
  });

  it("vermenigvuldigt correct bij qty > 1 zonder korting", () => {
    const item = maakRetourItem({
      unitPrice: "49.95",
      unitCompareAtPrice: null,
      returnQuantity: 3,
    });

    const resultaat = computeLineRefund(item);

    expect(resultaat.refundAmount).toBe("149.85");
    expect(resultaat.appliedRule).toBe("no_discount");
  });

  // -- Scenario 2: compare_at_price > unitPrice (korting) --

  it("refund = betaalde prijs × qty bij kortingsartikel", () => {
    const item = maakRetourItem({
      unitPrice: "39.95",
      unitCompareAtPrice: "79.95",
      returnQuantity: 1,
    });

    const resultaat = computeLineRefund(item);

    expect(resultaat.refundAmount).toBe("39.95");
    expect(resultaat.appliedRule).toBe("partial_discount");
  });

  it("berekent kortingspercentage correct bij 50% korting", () => {
    const item = maakRetourItem({
      unitPrice: "39.95",
      unitCompareAtPrice: "79.90",
      returnQuantity: 1,
    });

    const resultaat = computeLineRefund(item);

    // (79.90 - 39.95) / 79.90 * 100 ≈ 50.00
    const korting = parseFloat(resultaat.discountPercentage);
    expect(korting).toBeGreaterThan(49);
    expect(korting).toBeLessThan(51);
  });

  it("kortingsregel: refund is betaalde prijs, NIET adviesprijs", () => {
    const item = maakRetourItem({
      unitPrice: "119.95",
      unitCompareAtPrice: "199.95",
      returnQuantity: 1,
    });

    const resultaat = computeLineRefund(item);

    // Klant krijgt 119.95 terug, NIET 199.95
    expect(resultaat.refundAmount).toBe("119.95");
    expect(resultaat.appliedRule).toBe("partial_discount");
  });

  it("verwerkt 2 van 3 stuks correct bij kortingsartikel", () => {
    const item = maakRetourItem({
      unitPrice: "49.95",
      unitCompareAtPrice: "99.95",
      returnQuantity: 2,
    });

    const resultaat = computeLineRefund(item);

    // 2 × 49.95 = 99.90
    expect(resultaat.refundAmount).toBe("99.90");
    expect(resultaat.appliedRule).toBe("partial_discount");
  });

  // -- Scenario 3: compare_at_price < unitPrice (corrupte data) --

  it("valt terug op unitPrice bij corrupte compare_at_price < unitPrice", () => {
    const item = maakRetourItem({
      unitPrice: "199.95",
      unitCompareAtPrice: "149.95", // corrupt: lager dan betaalde prijs
      returnQuantity: 1,
    });

    const resultaat = computeLineRefund(item);

    // Terugval naar betaalde prijs — nooit meer terugbetalen dan betaald
    expect(resultaat.refundAmount).toBe("199.95");
    expect(resultaat.appliedRule).toBe("no_discount");
    expect(resultaat.discountPercentage).toBe("0.00");
  });

  // -- Scenario 4: compare_at_price == unitPrice --

  it("geen korting als compare_at_price gelijk is aan unitPrice", () => {
    const item = maakRetourItem({
      unitPrice: "79.95",
      unitCompareAtPrice: "79.95",
      returnQuantity: 1,
    });

    const resultaat = computeLineRefund(item);

    expect(resultaat.refundAmount).toBe("79.95");
    expect(resultaat.appliedRule).toBe("no_discount");
    expect(resultaat.discountPercentage).toBe("0.00");
  });

  // -- Scenario 5: Gedeeltelijke retour --

  it("berekent correct bij gedeeltelijke retour (2 van 3)", () => {
    const item = maakRetourItem({
      unitPrice: "79.95",
      unitCompareAtPrice: null,
      returnQuantity: 2,
    });

    const resultaat = computeLineRefund(item);

    // 2 × 79.95 = 159.90
    expect(resultaat.refundAmount).toBe("159.90");
  });

  it("berekent correct bij retour van slechts 1 van 5 stuks", () => {
    const item = maakRetourItem({
      unitPrice: "29.95",
      unitCompareAtPrice: null,
      returnQuantity: 1,
    });

    const resultaat = computeLineRefund(item);

    expect(resultaat.refundAmount).toBe("29.95");
  });

  // -- Final-sale guard --

  it("gooit FinalSaleGuardError bij isFinalSale=true", () => {
    const item = maakRetourItem({ isFinalSale: true });

    expect(() => computeLineRefund(item)).toThrow(FinalSaleGuardError);
  });

  it("FinalSaleGuardError bevat het lineItemId", () => {
    const item = maakRetourItem({
      shopifyLineItemId: "gid://shopify/LineItem/final_sale_999",
      isFinalSale: true,
    });

    try {
      computeLineRefund(item);
      expect.fail("Zou FinalSaleGuardError moeten gooien");
    } catch (fout) {
      expect(fout).toBeInstanceOf(FinalSaleGuardError);
      const guard = fout as FinalSaleGuardError;
      expect(guard.lineItemId).toBe("gid://shopify/LineItem/final_sale_999");
    }
  });

  // -- Invoervalidatie --

  it("gooit ZodError bij returnQuantity = 0", () => {
    const { ZodError } = require("zod");
    const item = maakRetourItem({ returnQuantity: 0 });
    expect(() => computeLineRefund(item)).toThrow(ZodError);
  });

  it("gooit ZodError bij negatieve returnQuantity", () => {
    const { ZodError } = require("zod");
    const item = maakRetourItem({ returnQuantity: -1 });
    expect(() => computeLineRefund(item)).toThrow(ZodError);
  });

  it("gooit ZodError bij ongeldige unitPrice string", () => {
    const { ZodError } = require("zod");
    const item = maakRetourItem({ unitPrice: "niet_een_prijs" });
    expect(() => computeLineRefund(item)).toThrow(ZodError);
  });

  // -- Floating-point precisie --

  it("vermijdt floating-point afrondingsfouten", () => {
    // 0.1 + 0.2 is een klassiek JS float-probleem
    const item = maakRetourItem({
      unitPrice: "0.10",
      unitCompareAtPrice: null,
      returnQuantity: 3,
    });

    const resultaat = computeLineRefund(item);

    // Moet precies 0.30 zijn, niet 0.30000000000000004
    expect(resultaat.refundAmount).toBe("0.30");
  });

  it("slaat op als string met altijd 2 decimalen", () => {
    const item = maakRetourItem({
      unitPrice: "100.00",
      unitCompareAtPrice: null,
      returnQuantity: 1,
    });

    const resultaat = computeLineRefund(item);

    expect(resultaat.refundAmount).toMatch(/^\d+\.\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// computeTotalRefund() — meerdere items
// ---------------------------------------------------------------------------

describe("computeTotalRefund()", () => {
  it("berekent correct totaal voor gemengd winkelmandje", () => {
    const items: ReturnLineItem[] = [
      // Volledig-prijs
      maakRetourItem({ unitPrice: "199.95", unitCompareAtPrice: null, returnQuantity: 1 }),
      // Met korting (50%)
      maakRetourItem({
        shopifyLineItemId: "gid://shopify/LineItem/222",
        unitPrice: "49.95",
        unitCompareAtPrice: "99.95",
        returnQuantity: 2,
      }),
    ];

    const totaal = computeTotalRefund(items);

    // 199.95 + (49.95 × 2) = 199.95 + 99.90 = 299.85
    expect(totaal).toBe("299.85");
  });

  it("berekent items onafhankelijk (gemengd mandje)", () => {
    const items: ReturnLineItem[] = [
      maakRetourItem({ unitPrice: "79.95", returnQuantity: 1 }),
      maakRetourItem({
        shopifyLineItemId: "gid://shopify/LineItem/333",
        unitPrice: "39.95",
        returnQuantity: 1,
      }),
      maakRetourItem({
        shopifyLineItemId: "gid://shopify/LineItem/444",
        unitPrice: "119.95",
        returnQuantity: 1,
      }),
    ];

    const totaal = computeTotalRefund(items);

    // 79.95 + 39.95 + 119.95 = 239.85
    expect(totaal).toBe("239.85");
  });

  it("geeft '0.00' terug voor lege array", () => {
    expect(computeTotalRefund([])).toBe("0.00");
  });

  it("geeft correct bedrag voor enkelvoudig item", () => {
    const items: ReturnLineItem[] = [
      maakRetourItem({ unitPrice: "199.95", returnQuantity: 1 }),
    ];

    expect(computeTotalRefund(items)).toBe("199.95");
  });

  it("gooit als één item final-sale is", () => {
    const items: ReturnLineItem[] = [
      maakRetourItem({ unitPrice: "79.95" }),
      maakRetourItem({
        shopifyLineItemId: "gid://shopify/LineItem/final",
        isFinalSale: true,
      }),
    ];

    expect(() => computeTotalRefund(items)).toThrow(FinalSaleGuardError);
  });
});

/**
 * Terugbetalingsberekening — JANICE Returns & Exchanges app — PR #2
 *
 * Implementeert de "60%-kortingsregel":
 *   Klanten die een promotie-artikel retourneren, ontvangen het werkelijk
 *   betaalde bedrag terug — NIET de oorspronkelijke adviesprijs.
 *
 * Alle geldbedragen worden verwerkt via Decimal.js — nooit native JS floats.
 * Opslag in Postgres als numeric(10,2) in EUR.
 *
 * Regels:
 *  - compare_at_price null/ontbrekend → geen korting → refund = unitPrice × qty
 *  - compare_at_price > unitPrice → korting actief → refund = unitPrice × qty
 *  - compare_at_price < unitPrice → corrupte data → log waarschuwing, gebruik unitPrice
 *  - compare_at_price == unitPrice → geen korting → refund = unitPrice × qty
 *  - final-sale items mogen deze functie nooit bereiken → gooit FinalSaleGuardError
 *  - Gedeeltelijke retour (qty < gekochte qty): refund = unitPrice × returnedQty
 */

import Decimal from "decimal.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export type AppliedRule =
  | "no_discount"
  | "partial_discount"
  | "final_sale_blocked";

export interface LineRefundResult {
  /** Terugbetaald bedrag in EUR (als Decimal-string voor opslag) */
  refundAmount: string;
  /** Kortingspercentage (0 als geen korting) */
  discountPercentage: string;
  /** Toegepaste regel */
  appliedRule: AppliedRule;
}

// ---------------------------------------------------------------------------
// Invoertype voor een te retourneren line item
// ---------------------------------------------------------------------------

const ReturnLineItemSchema = z.object({
  shopifyLineItemId: z.string().min(1),
  productTitle: z.string(),
  /** Werkelijk betaalde prijs per stuk als decimale string, bijv. "49.95" */
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Moet een geldig bedrag zijn"),
  /** Oorspronkelijke prijs vóór korting — null als er geen korting gold */
  unitCompareAtPrice: z.string().nullable().optional(),
  /** Aantal te retourneren stuks */
  returnQuantity: z.number().int().positive(),
  /** Markering of dit een final-sale artikel is */
  isFinalSale: z.boolean().default(false),
});

export type ReturnLineItem = z.infer<typeof ReturnLineItemSchema>;

// ---------------------------------------------------------------------------
// Foutklasse
// ---------------------------------------------------------------------------

/**
 * Gooit wanneer een final-sale artikel de refund-calculator bereikt.
 * De eligibility engine hoort dit te blokkeren — dit is een defensieve garde.
 */
export class FinalSaleGuardError extends Error {
  public readonly lineItemId: string;

  constructor(lineItemId: string) {
    super(
      `Final-sale artikel ${lineItemId} mag de terugbetalingsberekening nooit bereiken. ` +
        "De eligibility engine moet dit blokkeren.",
    );
    this.name = "FinalSaleGuardError";
    this.lineItemId = lineItemId;
  }
}

// ---------------------------------------------------------------------------
// Per-line berekening
// ---------------------------------------------------------------------------

/**
 * Bereken het terugbetaalde bedrag voor één line item.
 *
 * @param line - Het te retourneren line item inclusief prijsgegevens
 * @returns Terugbetaling, kortingspercentage en toegepaste regel
 * @throws {FinalSaleGuardError} Als isFinalSale=true (defensieve garde)
 * @throws {z.ZodError} Als de invoer niet valide is
 *
 * @example Volledig-prijs artikel
 * computeLineRefund({ unitPrice: "79.95", unitCompareAtPrice: null, returnQuantity: 1, ... })
 * // → { refundAmount: "79.95", discountPercentage: "0.00", appliedRule: "no_discount" }
 *
 * @example Kortingsartikel
 * computeLineRefund({ unitPrice: "39.95", unitCompareAtPrice: "79.95", returnQuantity: 2, ... })
 * // → { refundAmount: "79.90", discountPercentage: "50.03", appliedRule: "partial_discount" }
 */
export function computeLineRefund(line: ReturnLineItem): LineRefundResult {
  // Valideer invoer via Zod
  const gevalideerd = ReturnLineItemSchema.parse(line);

  // Defensieve final-sale garde
  if (gevalideerd.isFinalSale) {
    throw new FinalSaleGuardError(gevalideerd.shopifyLineItemId);
  }

  const unitPrice = new Decimal(gevalideerd.unitPrice);
  const returnQty = new Decimal(gevalideerd.returnQuantity);

  // Scenario 1: Geen compare_at_price beschikbaar → geen korting
  if (!gevalideerd.unitCompareAtPrice) {
    const refund = unitPrice.times(returnQty).toDecimalPlaces(2);
    return {
      refundAmount: refund.toFixed(2),
      discountPercentage: "0.00",
      appliedRule: "no_discount",
    };
  }

  const compareAtPrice = new Decimal(gevalideerd.unitCompareAtPrice);

  // Scenario 2: Corrupte data — compare_at_price kleiner dan betaalde prijs
  // Log een waarschuwing en gebruik de betaalde prijs als terugval
  if (compareAtPrice.lessThan(unitPrice)) {
    console.warn(
      `[refund-calculator] Corrupte prijsdata voor line item ${gevalideerd.shopifyLineItemId}: ` +
        `compare_at_price (${compareAtPrice.toFixed(2)}) < unit_price (${unitPrice.toFixed(2)}). ` +
        `Terugval naar unit_price om overstorting te voorkomen.`,
    );
    const refund = unitPrice.times(returnQty).toDecimalPlaces(2);
    return {
      refundAmount: refund.toFixed(2),
      discountPercentage: "0.00",
      appliedRule: "no_discount",
    };
  }

  // Scenario 3: compare_at_price == unit_price → geen effectieve korting
  if (compareAtPrice.equals(unitPrice)) {
    const refund = unitPrice.times(returnQty).toDecimalPlaces(2);
    return {
      refundAmount: refund.toFixed(2),
      discountPercentage: "0.00",
      appliedRule: "no_discount",
    };
  }

  // Scenario 4: compare_at_price > unit_price → korting actief
  // Refund = werkelijk betaalde prijs × retourquantiteit
  const discountPercentage = compareAtPrice
    .minus(unitPrice)
    .dividedBy(compareAtPrice)
    .times(100)
    .toDecimalPlaces(2);

  const refund = unitPrice.times(returnQty).toDecimalPlaces(2);

  return {
    refundAmount: refund.toFixed(2),
    discountPercentage: discountPercentage.toFixed(2),
    appliedRule: "partial_discount",
  };
}

// ---------------------------------------------------------------------------
// Totaalbedrag over meerdere lines
// ---------------------------------------------------------------------------

/**
 * Bereken het totale terugbetaalde bedrag voor een selectie van line items.
 * Elk item wordt onafhankelijk berekend (gemengd winkelmandje ondersteund).
 *
 * @param lines - Array van te retourneren line items
 * @returns Totaal terugbetaald bedrag als decimale string (bijv. "159.90")
 */
export function computeTotalRefund(lines: ReturnLineItem[]): string {
  const totaal = lines.reduce((som, line) => {
    const { refundAmount } = computeLineRefund(line);
    return som.plus(new Decimal(refundAmount));
  }, new Decimal(0));

  return totaal.toDecimalPlaces(2).toFixed(2);
}

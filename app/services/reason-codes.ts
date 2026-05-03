/**
 * Retourredencodes en automatische routing — JANICE Returns & Exchanges app — PR #2
 *
 * Definieert 8 retourredencodes conform PRD §6.1 en berekent de automatische
 * routing per redencode (welke afhandeling gesuggereerd wordt, of ops-review
 * vereist is, en of de klant de afhandeling mag overschrijven).
 *
 * Display-teksten leven uitsluitend in de UI (i18n) — dit bestand emiteert
 * alleen codes en routeringsinformatie.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Redencodes
// ---------------------------------------------------------------------------

export const ReasonCodeEnum = z.enum([
  "TOO_BIG",
  "TOO_SMALL",
  "COLOR_DIFFERENT",
  "DAMAGED",
  "LATE_DELIVERY",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "CHANGED_MIND",
]);

export type ReasonCode = z.infer<typeof ReasonCodeEnum>;

// ---------------------------------------------------------------------------
// Resoluties
// ---------------------------------------------------------------------------

export const ResolutionEnum = z.enum(["refund", "exchange", "store_credit"]);

export type Resolution = z.infer<typeof ResolutionEnum>;

// ---------------------------------------------------------------------------
// Routeringsresultaat
// ---------------------------------------------------------------------------

export interface RoutingResult {
  /** Standaard gesuggereerde afhandeling */
  defaultResolution: Resolution;
  /**
   * True als een medewerker de retour handmatig moet beoordelen.
   * Bijv. bij beschadiging, te laat geleverd, verkeerd artikel.
   */
  requiresOpsReview: boolean;
  /**
   * True als de klant zelf de afhandeling mag kiezen of aanpassen.
   * False bij retours die ops-only beslissingen vereisen.
   */
  customerCanOverride: boolean;
  /**
   * Optionele hint voor de UI over wat de klant te bieden is.
   * i18n-sleutel — geen display-tekst.
   */
  uiHint?: string;
}

// ---------------------------------------------------------------------------
// Routeringsconfiguratie per redencode
// ---------------------------------------------------------------------------

/**
 * Definitieve routeringsregels per redencode.
 * Aanpasbaar per seizoen — wijzigingen hier werken door in de volledige UI.
 */
const ROUTING_CONFIG: Readonly<Record<ReasonCode, RoutingResult>> = {
  /**
   * Te groot: klant wil waarschijnlijk een maat kleiner.
   * Automatisch ruilen voorgesteld (maat omlaag).
   */
  TOO_BIG: {
    defaultResolution: "exchange",
    requiresOpsReview: false,
    customerCanOverride: true,
    uiHint: "suggest_exchange_size_down",
  },

  /**
   * Te klein: klant wil waarschijnlijk een maat groter.
   * Automatisch ruilen voorgesteld (maat omhoog).
   */
  TOO_SMALL: {
    defaultResolution: "exchange",
    requiresOpsReview: false,
    customerCanOverride: true,
    uiHint: "suggest_exchange_size_up",
  },

  /**
   * Kleur wijkt af van foto: geen zinvol ruilalternatief.
   * Terugbetaling enige logische optie.
   */
  COLOR_DIFFERENT: {
    defaultResolution: "refund",
    requiresOpsReview: false,
    customerCanOverride: false,
    uiHint: "color_mismatch_refund_only",
  },

  /**
   * Beschadigd artikel: ops moet fysieke staat beoordelen.
   * Restocking vrijgesteld bij bevestigde schade. Full refund.
   */
  DAMAGED: {
    defaultResolution: "refund",
    requiresOpsReview: true,
    customerCanOverride: false,
    uiHint: "damaged_ops_review_required",
  },

  /**
   * Te laat geleverd: ops beoordeelt of compensatie van toepassing is.
   * Klant betaalt geen retourkosten — retourlabel gratis.
   */
  LATE_DELIVERY: {
    defaultResolution: "refund",
    requiresOpsReview: true,
    customerCanOverride: false,
    uiHint: "late_delivery_compensation_possible",
  },

  /**
   * Verkeerd artikel ontvangen: ops-review + gratis label + full refund.
   * Klant krijgt ook het juiste artikel nagestuurd indien beschikbaar.
   */
  WRONG_ITEM: {
    defaultResolution: "refund",
    requiresOpsReview: true,
    customerCanOverride: false,
    uiHint: "wrong_item_reship_possible",
  },

  /**
   * Artikel voldoet niet aan beschrijving/foto: ops-review vereist.
   * Terugbetaling als uitkomst.
   */
  NOT_AS_DESCRIBED: {
    defaultResolution: "refund",
    requiresOpsReview: true,
    customerCanOverride: false,
    uiHint: "not_as_described_ops_review",
  },

  /**
   * Van gedachten veranderd: klant kiest zelf (terugbetaling of ruilen).
   * Geen ops-review nodig voor standaard gevallen.
   */
  CHANGED_MIND: {
    defaultResolution: "refund",
    requiresOpsReview: false,
    customerCanOverride: true,
    uiHint: "changed_mind_customer_choice",
  },
};

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

/**
 * Geeft de automatische routing terug voor een retourredencode.
 *
 * @param reasonCode - Een van de 8 RetourReasonCode waarden
 * @returns Routeringsinformatie inclusief standaard afhandeling en ops-review vlag
 * @throws {z.ZodError} Als de redencode niet geldig is
 *
 * @example
 * getAutoRouting("TOO_SMALL")
 * // → { defaultResolution: "exchange", requiresOpsReview: false,
 * //     customerCanOverride: true, uiHint: "suggest_exchange_size_up" }
 *
 * @example
 * getAutoRouting("DAMAGED")
 * // → { defaultResolution: "refund", requiresOpsReview: true,
 * //     customerCanOverride: false, uiHint: "damaged_ops_review_required" }
 */
export function getAutoRouting(reasonCode: ReasonCode): RoutingResult {
  // Valideer invoer
  const gevalideerdCode = ReasonCodeEnum.parse(reasonCode);
  return ROUTING_CONFIG[gevalideerdCode];
}

/**
 * Geeft alle beschikbare redencodes terug.
 * Handig voor formuliervalidatie in de UI.
 */
export function getAllReasonCodes(): ReasonCode[] {
  return ReasonCodeEnum.options as ReasonCode[];
}

/**
 * Controleer of een redencode ops-review vereist.
 * Korte helper voor conditionele logica in de service-laag.
 */
export function requiresOpsReview(reasonCode: ReasonCode): boolean {
  return getAutoRouting(reasonCode).requiresOpsReview;
}

/**
 * Geeft alle redencodes terug die ops-review vereisen.
 */
export function getOpsReviewCodes(): ReasonCode[] {
  return getAllReasonCodes().filter((code) => requiresOpsReview(code));
}

/**
 * Tests voor reason-codes.ts — JANICE Returns & Exchanges app
 *
 * Dekt:
 *  - Alle 8 redencodes
 *  - Juiste defaultResolution per code
 *  - Juiste requiresOpsReview vlag
 *  - Juiste customerCanOverride vlag
 *  - getAllReasonCodes() volledigheid
 *  - getOpsReviewCodes() correctheid
 *  - requiresOpsReview() helper
 *  - ZodError bij ongeldige code
 */

import { describe, it, expect } from "vitest";
import {
  getAutoRouting,
  getAllReasonCodes,
  getOpsReviewCodes,
  requiresOpsReview,
  ReasonCodeEnum,
  type ReasonCode,
} from "./reason-codes.js";

// ---------------------------------------------------------------------------
// Alle 8 redencodes — defaultResolution
// ---------------------------------------------------------------------------

describe("getAutoRouting() — defaultResolution", () => {
  it("TOO_BIG → exchange (maat omlaag suggereren)", () => {
    const routing = getAutoRouting("TOO_BIG");
    expect(routing.defaultResolution).toBe("exchange");
  });

  it("TOO_SMALL → exchange (maat omhoog suggereren)", () => {
    const routing = getAutoRouting("TOO_SMALL");
    expect(routing.defaultResolution).toBe("exchange");
  });

  it("COLOR_DIFFERENT → refund (geen zinvol ruilalternatief)", () => {
    const routing = getAutoRouting("COLOR_DIFFERENT");
    expect(routing.defaultResolution).toBe("refund");
  });

  it("DAMAGED → refund (ops beslist na inspectie)", () => {
    const routing = getAutoRouting("DAMAGED");
    expect(routing.defaultResolution).toBe("refund");
  });

  it("LATE_DELIVERY → refund (compensatie mogelijk)", () => {
    const routing = getAutoRouting("LATE_DELIVERY");
    expect(routing.defaultResolution).toBe("refund");
  });

  it("WRONG_ITEM → refund (full refund + mogelijk reship)", () => {
    const routing = getAutoRouting("WRONG_ITEM");
    expect(routing.defaultResolution).toBe("refund");
  });

  it("NOT_AS_DESCRIBED → refund", () => {
    const routing = getAutoRouting("NOT_AS_DESCRIBED");
    expect(routing.defaultResolution).toBe("refund");
  });

  it("CHANGED_MIND → refund (standaard, klant kan wijzigen)", () => {
    const routing = getAutoRouting("CHANGED_MIND");
    expect(routing.defaultResolution).toBe("refund");
  });
});

// ---------------------------------------------------------------------------
// requiresOpsReview
// ---------------------------------------------------------------------------

describe("getAutoRouting() — requiresOpsReview", () => {
  it("TOO_BIG vereist geen ops-review", () => {
    expect(getAutoRouting("TOO_BIG").requiresOpsReview).toBe(false);
  });

  it("TOO_SMALL vereist geen ops-review", () => {
    expect(getAutoRouting("TOO_SMALL").requiresOpsReview).toBe(false);
  });

  it("COLOR_DIFFERENT vereist geen ops-review", () => {
    expect(getAutoRouting("COLOR_DIFFERENT").requiresOpsReview).toBe(false);
  });

  it("DAMAGED vereist ops-review", () => {
    expect(getAutoRouting("DAMAGED").requiresOpsReview).toBe(true);
  });

  it("LATE_DELIVERY vereist ops-review", () => {
    expect(getAutoRouting("LATE_DELIVERY").requiresOpsReview).toBe(true);
  });

  it("WRONG_ITEM vereist ops-review", () => {
    expect(getAutoRouting("WRONG_ITEM").requiresOpsReview).toBe(true);
  });

  it("NOT_AS_DESCRIBED vereist ops-review", () => {
    expect(getAutoRouting("NOT_AS_DESCRIBED").requiresOpsReview).toBe(true);
  });

  it("CHANGED_MIND vereist geen ops-review", () => {
    expect(getAutoRouting("CHANGED_MIND").requiresOpsReview).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// customerCanOverride
// ---------------------------------------------------------------------------

describe("getAutoRouting() — customerCanOverride", () => {
  it("TOO_BIG: klant kan override (keuze uit exchange/refund)", () => {
    expect(getAutoRouting("TOO_BIG").customerCanOverride).toBe(true);
  });

  it("TOO_SMALL: klant kan override", () => {
    expect(getAutoRouting("TOO_SMALL").customerCanOverride).toBe(true);
  });

  it("COLOR_DIFFERENT: klant kan NIET override (refund only)", () => {
    expect(getAutoRouting("COLOR_DIFFERENT").customerCanOverride).toBe(false);
  });

  it("DAMAGED: klant kan NIET override (ops-beslissing)", () => {
    expect(getAutoRouting("DAMAGED").customerCanOverride).toBe(false);
  });

  it("LATE_DELIVERY: klant kan NIET override", () => {
    expect(getAutoRouting("LATE_DELIVERY").customerCanOverride).toBe(false);
  });

  it("WRONG_ITEM: klant kan NIET override", () => {
    expect(getAutoRouting("WRONG_ITEM").customerCanOverride).toBe(false);
  });

  it("NOT_AS_DESCRIBED: klant kan NIET override", () => {
    expect(getAutoRouting("NOT_AS_DESCRIBED").customerCanOverride).toBe(false);
  });

  it("CHANGED_MIND: klant kan override (keuze exchange/refund)", () => {
    expect(getAutoRouting("CHANGED_MIND").customerCanOverride).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UI hints aanwezig
// ---------------------------------------------------------------------------

describe("getAutoRouting() — uiHint", () => {
  it("TOO_BIG heeft uiHint suggest_exchange_size_down", () => {
    expect(getAutoRouting("TOO_BIG").uiHint).toBe("suggest_exchange_size_down");
  });

  it("TOO_SMALL heeft uiHint suggest_exchange_size_up", () => {
    expect(getAutoRouting("TOO_SMALL").uiHint).toBe("suggest_exchange_size_up");
  });

  it("DAMAGED heeft uiHint over ops-review", () => {
    expect(getAutoRouting("DAMAGED").uiHint).toBe("damaged_ops_review_required");
  });
});

// ---------------------------------------------------------------------------
// getAllReasonCodes()
// ---------------------------------------------------------------------------

describe("getAllReasonCodes()", () => {
  it("geeft alle 8 redencodes terug", () => {
    const codes = getAllReasonCodes();
    expect(codes).toHaveLength(8);
  });

  it("bevat alle verwachte codes", () => {
    const codes = getAllReasonCodes();
    const verwacht: ReasonCode[] = [
      "TOO_BIG",
      "TOO_SMALL",
      "COLOR_DIFFERENT",
      "DAMAGED",
      "LATE_DELIVERY",
      "WRONG_ITEM",
      "NOT_AS_DESCRIBED",
      "CHANGED_MIND",
    ];
    for (const code of verwacht) {
      expect(codes).toContain(code);
    }
  });
});

// ---------------------------------------------------------------------------
// getOpsReviewCodes()
// ---------------------------------------------------------------------------

describe("getOpsReviewCodes()", () => {
  it("geeft precies 4 ops-review codes terug", () => {
    const opsCodes = getOpsReviewCodes();
    expect(opsCodes).toHaveLength(4);
  });

  it("bevat DAMAGED, LATE_DELIVERY, WRONG_ITEM, NOT_AS_DESCRIBED", () => {
    const opsCodes = getOpsReviewCodes();
    expect(opsCodes).toContain("DAMAGED");
    expect(opsCodes).toContain("LATE_DELIVERY");
    expect(opsCodes).toContain("WRONG_ITEM");
    expect(opsCodes).toContain("NOT_AS_DESCRIBED");
  });

  it("bevat GEEN automatische codes", () => {
    const opsCodes = getOpsReviewCodes();
    expect(opsCodes).not.toContain("TOO_BIG");
    expect(opsCodes).not.toContain("TOO_SMALL");
    expect(opsCodes).not.toContain("COLOR_DIFFERENT");
    expect(opsCodes).not.toContain("CHANGED_MIND");
  });
});

// ---------------------------------------------------------------------------
// requiresOpsReview() helper
// ---------------------------------------------------------------------------

describe("requiresOpsReview()", () => {
  it("geeft true terug voor DAMAGED", () => {
    expect(requiresOpsReview("DAMAGED")).toBe(true);
  });

  it("geeft false terug voor TOO_BIG", () => {
    expect(requiresOpsReview("TOO_BIG")).toBe(false);
  });

  it("is consistent met getAutoRouting().requiresOpsReview", () => {
    const allesCodes = getAllReasonCodes();
    for (const code of allesCodes) {
      expect(requiresOpsReview(code)).toBe(
        getAutoRouting(code).requiresOpsReview,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Invoervalidatie
// ---------------------------------------------------------------------------

describe("getAutoRouting() — ongeldige invoer", () => {
  it("gooit ZodError bij ongeldige redencode", () => {
    const { ZodError } = require("zod");
    expect(() => getAutoRouting("ONBEKEND_CODE" as ReasonCode)).toThrow(ZodError);
  });

  it("gooit ZodError bij lege string", () => {
    const { ZodError } = require("zod");
    expect(() => getAutoRouting("" as ReasonCode)).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// ReasonCodeEnum volledigheid
// ---------------------------------------------------------------------------

describe("ReasonCodeEnum", () => {
  it("heeft precies 8 waarden", () => {
    expect(ReasonCodeEnum.options).toHaveLength(8);
  });
});

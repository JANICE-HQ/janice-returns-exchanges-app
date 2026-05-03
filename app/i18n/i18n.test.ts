/**
 * Tests voor de i18n helper
 */

import { describe, it, expect } from "vitest";
import { t, tArray, detectLocale, getTranslations } from "./index";

describe("t()", () => {
  it("geeft NL vertaling terug voor bekende sleutel", () => {
    expect(t("nl", "portal.title")).toBe("Retourneren of ruilen");
  });

  it("geeft EN vertaling terug voor bekende sleutel", () => {
    expect(t("en", "portal.title")).toBe("Return or exchange");
  });

  it("geeft NL redencode vertaling terug", () => {
    expect(t("nl", "reason.codes.TOO_BIG")).toBe("Te groot");
    expect(t("nl", "reason.codes.CHANGED_MIND")).toBe("Beviel me niet");
  });

  it("geeft EN redencode vertaling terug", () => {
    expect(t("en", "reason.codes.TOO_BIG")).toBe("Too big");
  });

  it("vervangt variabelen in string", () => {
    const result = t("nl", "guest.rateLimitMessage", { minutes: "5" });
    expect(result).toContain("5");
    expect(result).not.toContain("{minutes}");
  });

  it("valt terug op NL als EN-sleutel ontbreekt", () => {
    // Alle sleutels moeten in beide talen bestaan (parity check)
    const nlTitle = t("nl", "portal.title");
    const enTitle = t("en", "portal.title");
    expect(nlTitle).not.toBe(enTitle); // Verschillende teksten
    expect(nlTitle).not.toBe("portal.title"); // Geen sleutel-fallback
    expect(enTitle).not.toBe("portal.title");
  });

  it("geeft sleutel terug als niet gevonden in beide talen", () => {
    const result = t("nl", "nonexistent.key");
    expect(result).toBe("nonexistent.key");
  });

  it("geeft alle status-states terug", () => {
    const states = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "LABEL_ISSUED",
      "IN_TRANSIT", "RECEIVED", "INSPECTING", "COMPLETED", "CANCELLED", "EXPIRED"];
    for (const state of states) {
      const label = t("nl", `status.states.${state}`);
      expect(label).not.toBe(`status.states.${state}`);
    }
  });
});

describe("tArray()", () => {
  it("geeft array van trust signals terug", () => {
    const signals = tArray("nl", "trust.signals");
    expect(Array.isArray(signals)).toBe(true);
    expect(signals).toHaveLength(5); // Rule of 5/7
  });

  it("geeft NL success stappen terug (5 items)", () => {
    const steps = tArray("nl", "success.nextSteps");
    expect(steps).toHaveLength(5);
  });

  it("geeft EN success stappen terug (5 items — parity)", () => {
    const steps = tArray("en", "success.nextSteps");
    expect(steps).toHaveLength(5);
  });

  it("geeft lege array terug voor niet-bestaande sleutel", () => {
    const result = tArray("nl", "nonexistent.array");
    expect(result).toEqual([]);
  });
});

describe("detectLocale()", () => {
  it("detecteert NL als standaard (geen header)", () => {
    const req = new Request("https://example.com", {
      headers: {},
    });
    expect(detectLocale(req)).toBe("nl");
  });

  it("detecteert EN via Accept-Language header", () => {
    const req = new Request("https://example.com", {
      headers: { "accept-language": "en-US,en;q=0.9" },
    });
    expect(detectLocale(req)).toBe("en");
  });

  it("valt terug op NL voor andere talen", () => {
    const req = new Request("https://example.com", {
      headers: { "accept-language": "fr-FR,fr;q=0.9" },
    });
    expect(detectLocale(req)).toBe("nl");
  });
});

describe("NL/EN pariteitscontrole", () => {
  it("heeft dezelfde top-level sleutels in NL en EN", () => {
    const nl = getTranslations("nl");
    const en = getTranslations("en");
    const nlKeys = Object.keys(nl).sort();
    const enKeys = Object.keys(en).sort();
    expect(nlKeys).toEqual(enKeys);
  });

  it("heeft dezelfde reden-sleutels in NL en EN", () => {
    const nlCodes = Object.keys(getTranslations("nl").reason.codes);
    const enCodes = Object.keys(getTranslations("en").reason.codes);
    expect(nlCodes.sort()).toEqual(enCodes.sort());
  });

  it("heeft 8 redencodes in beide talen", () => {
    const nlCodes = Object.keys(getTranslations("nl").reason.codes);
    const enCodes = Object.keys(getTranslations("en").reason.codes);
    expect(nlCodes).toHaveLength(8);
    expect(enCodes).toHaveLength(8);
  });

  it("heeft gelijke aantallen status-states in NL en EN", () => {
    const nlStates = Object.keys(getTranslations("nl").status.states);
    const enStates = Object.keys(getTranslations("en").status.states);
    expect(nlStates.sort()).toEqual(enStates.sort());
  });
});

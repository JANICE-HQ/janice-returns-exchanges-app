/**
 * i18n helper — JANICE Returns Portal
 *
 * Eenvoudige lookup-helper op basis van JSON-bestanden.
 * NL primair, EN fallback. Volwaardige i18n-bibliotheek kan later worden
 * ingeplugd zonder UI-wijzigingen.
 */

import nlTranslations from "./nl.json";
import enTranslations from "./en.json";

export type Locale = "nl" | "en";

type TranslationData = typeof nlTranslations;

const translations: Record<Locale, TranslationData> = {
  nl: nlTranslations,
  en: enTranslations,
};

/**
 * Detecteer locale van een Request-object via Accept-Language header.
 * Valt terug op NL als standaard.
 */
export function detectLocale(request: Request): Locale {
  const acceptLanguage = request.headers.get("accept-language") ?? "";
  if (acceptLanguage.toLowerCase().includes("en")) {
    return "en";
  }
  return "nl";
}

/**
 * Haal een geneste vertaalsstring op via een dot-path.
 * Geeft de sleutel terug als de vertaling niet bestaat (nooit leeg weergeven).
 *
 * @example
 * t("nl", "portal.title") // "Retourneren of ruilen"
 * t("nl", "reason.codes.TOO_BIG") // "Te groot"
 */
export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = translations[locale];

  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      // Fallback naar NL als EN-sleutel ontbreekt
      if (locale !== "nl") {
        return t("nl", key, vars);
      }
      return key;
    }
    current = current[part];
  }

  if (typeof current !== "string") {
    if (locale !== "nl") {
      return t("nl", key, vars);
    }
    return key;
  }

  if (vars) {
    return current.replace(/\{(\w+)\}/g, (_, varKey) => {
      return String(vars[varKey] ?? `{${varKey}}`);
    });
  }

  return current;
}

/**
 * Haal een array van vertaalstrings op.
 * Geeft lege array terug als de sleutel geen array is.
 */
export function tArray(locale: Locale, key: string): string[] {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = translations[locale];

  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return [];
    }
    current = current[part];
  }

  if (!Array.isArray(current)) {
    return [];
  }
  return current as string[];
}

/**
 * Geef alle beschikbare vertalingen voor een locale.
 * Handig voor SSR-context die vertaaldata doorgeeft aan de client.
 */
export function getTranslations(locale: Locale): TranslationData {
  return translations[locale];
}

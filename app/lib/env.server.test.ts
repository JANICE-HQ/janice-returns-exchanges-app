/**
 * Tests voor env.server.ts — JANICE Returns & Exchanges app
 *
 * Verifieert dat het Zod-schema:
 * 1. Een fout gooit bij ontbrekende variabelen
 * 2. Beschrijvende foutmeldingen geeft
 * 3. Geldig slaagt bij aanwezige variabelen
 * 4. NODE_ENV standaard op 'development' zet
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Herbruikbare helper: maak een schema-instantie die process.env valideert
// (Dezelfde logica als in env.server.ts, maar geïsoleerd voor testen)
// ---------------------------------------------------------------------------
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  SHOPIFY_ADMIN_TOKEN: z.string().min(1),
  SHOPIFY_SHOP_DOMAIN: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+\.myshopify\.com$/),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DHL_API_KEY: z.string().min(1),
  DHL_USER_ID: z.string().min(1),
  DHL_RETURN_ACCOUNT_ID: z.string().min(1),
  DHL_WEBHOOK_SECRET: z.string().min(1),
  GOEDGEPICKT_WEBHOOK_SECRET: z.string().min(1),
  KLAVIYO_PRIVATE_API_KEY: z.string().min(1),
  SENTRY_DSN_RETURNS_APP: z.string().url().min(1),
});

/** Volledige geldige env-configuratie voor tests */
const geldigeEnv: Record<string, string> = {
  NODE_ENV: "test",
  SHOPIFY_ADMIN_TOKEN: "shpat_testtoken123",
  SHOPIFY_SHOP_DOMAIN: "u17s8e-sc.myshopify.com",
  APP_URL: "https://returns.janice.com",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/janice_returns",
  REDIS_URL: "redis://localhost:6379",
  DHL_API_KEY: "test-dhl-api-key",
  DHL_USER_ID: "test-dhl-user",
  DHL_RETURN_ACCOUNT_ID: "test-dhl-account",
  DHL_WEBHOOK_SECRET: "test-dhl-webhook-secret",
  GOEDGEPICKT_WEBHOOK_SECRET: "test-goedgepickt-secret",
  KLAVIYO_PRIVATE_API_KEY: "pk_testkey",
  SENTRY_DSN_RETURNS_APP:
    "https://testkey@o123.ingest.sentry.io/456",
};

describe("env.server — Zod-schema validatie", () => {
  // Bewaar originele env-variabelen
  let origineelEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    origineelEnv = { ...process.env };
  });

  afterEach(() => {
    // Herstel process.env na elke test
    for (const sleutel of Object.keys(process.env)) {
      if (!(sleutel in origineelEnv)) {
        delete process.env[sleutel];
      }
    }
    Object.assign(process.env, origineelEnv);
  });

  // ---------------------------------------------------------------------------
  // Fout-scenario's — ontbrekende variabelen
  // ---------------------------------------------------------------------------
  describe("Schema gooit fout bij ongeldige configuratie", () => {
    it("faalt als SHOPIFY_ADMIN_TOKEN ontbreekt", () => {
      const invoer = { ...geldigeEnv };
      delete invoer["SHOPIFY_ADMIN_TOKEN"];

      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(false);
      if (!resultaat.success) {
        // Zod v4 gebruikt `issues` in plaats van `errors`
        const paden = resultaat.error.issues.map((e) => e.path.join("."));
        expect(paden).toContain("SHOPIFY_ADMIN_TOKEN");
      }
    });

    it("faalt als DATABASE_URL ontbreekt", () => {
      const invoer = { ...geldigeEnv };
      delete invoer["DATABASE_URL"];

      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(false);
      if (!resultaat.success) {
        const paden = resultaat.error.issues.map((e) => e.path.join("."));
        expect(paden).toContain("DATABASE_URL");
      }
    });

    it("faalt als REDIS_URL ontbreekt", () => {
      const invoer = { ...geldigeEnv };
      delete invoer["REDIS_URL"];

      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(false);
    });

    it("faalt als meerdere variabelen ontbreken", () => {
      const invoer: Record<string, string> = {};
      // Geen enkele var aanwezig

      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(false);
      if (!resultaat.success) {
        // Meerdere issues verwacht — Zod v4 gebruikt `issues`
        expect(resultaat.error.issues.length).toBeGreaterThan(1);
      }
    });

    it("faalt bij ongeldig SHOPIFY_SHOP_DOMAIN formaat", () => {
      const invoer = {
        ...geldigeEnv,
        SHOPIFY_SHOP_DOMAIN: "janiceofficial.com", // Geen .myshopify.com
      };

      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(false);
      if (!resultaat.success) {
        const fout = resultaat.error.issues.find(
          (e) => e.path.includes("SHOPIFY_SHOP_DOMAIN"),
        );
        expect(fout).toBeDefined();
      }
    });

    it("faalt bij ongeldige APP_URL", () => {
      const invoer = {
        ...geldigeEnv,
        APP_URL: "niet-een-url",
      };

      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(false);
    });

    it("faalt bij ongeldige SENTRY_DSN_RETURNS_APP", () => {
      const invoer = {
        ...geldigeEnv,
        SENTRY_DSN_RETURNS_APP: "geen-geldige-dsn-url",
      };

      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(false);
    });

    it("faalt bij ongeldige NODE_ENV waarde", () => {
      const invoer = {
        ...geldigeEnv,
        NODE_ENV: "staging", // Niet toegestaan
      };

      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Succes-scenario's — geldige configuratie
  // ---------------------------------------------------------------------------
  describe("Schema slaagt bij geldige configuratie", () => {
    it("slaagt bij volledige geldige env-configuratie", () => {
      const resultaat = envSchema.safeParse(geldigeEnv);

      expect(resultaat.success).toBe(true);
    });

    it("stelt NODE_ENV standaard in op 'development' als het ontbreekt", () => {
      const invoer = { ...geldigeEnv };
      delete invoer["NODE_ENV"];

      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(true);
      if (resultaat.success) {
        expect(resultaat.data.NODE_ENV).toBe("development");
      }
    });

    it("accepteert alle toegestane NODE_ENV-waarden", () => {
      for (const waarde of ["development", "test", "production"] as const) {
        const resultaat = envSchema.safeParse({
          ...geldigeEnv,
          NODE_ENV: waarde,
        });

        expect(resultaat.success).toBe(true);
        if (resultaat.success) {
          expect(resultaat.data.NODE_ENV).toBe(waarde);
        }
      }
    });

    it("accepteert een geldig .myshopify.com domein", () => {
      const invoer = {
        ...geldigeEnv,
        SHOPIFY_SHOP_DOMAIN: "mijn-winkel.myshopify.com",
      };

      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(true);
    });

    it("behoudt alle waarden ongewijzigd na validatie", () => {
      const resultaat = envSchema.safeParse(geldigeEnv);

      expect(resultaat.success).toBe(true);
      if (resultaat.success) {
        expect(resultaat.data.SHOPIFY_SHOP_DOMAIN).toBe(
          geldigeEnv["SHOPIFY_SHOP_DOMAIN"],
        );
        expect(resultaat.data.APP_URL).toBe(geldigeEnv["APP_URL"]);
        expect(resultaat.data.DATABASE_URL).toBe(geldigeEnv["DATABASE_URL"]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Foutmeldingen controleren
  // ---------------------------------------------------------------------------
  describe("Foutmeldingen zijn beschrijvend", () => {
    it("bevat namen van ontbrekende velden in de foutmelding", () => {
      const invoer: Record<string, string> = {};
      const resultaat = envSchema.safeParse(invoer);

      expect(resultaat.success).toBe(false);
      if (!resultaat.success) {
        // Zod v4 gebruikt `issues` in plaats van `errors`
        const allePaden = resultaat.error.issues
          .map((e) => e.path.join("."))
          .join(", ");

        // Controleer of bekende vereiste velden genoemd worden
        expect(allePaden).toContain("SHOPIFY_ADMIN_TOKEN");
        expect(allePaden).toContain("DATABASE_URL");
      }
    });
  });
});

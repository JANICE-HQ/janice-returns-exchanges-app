/**
 * Tests voor shopify-token-manager.server.ts — JANICE Returns & Exchanges app
 *
 * Dekt:
 *  - Gecachte token retourneren als vers
 *  - Token vernieuwen als TTL binnen veiligheidsmarge
 *  - Terugval naar statisch SHOPIFY_ADMIN_TOKEN
 *  - Gelijktijdige aanroepen delen één in-flight vernieuwing (geen thundering herd)
 *  - invalidateShopifyAdminToken() dwingt vernieuwing af bij volgende aanroep
 *  - 5xx-respons gooit fout (geen retry op infra-fouten)
 *  - 4xx-respons gooit ShopifyAuthFout (geen retry op auth-fouten)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Redis } from "ioredis";

// ---------------------------------------------------------------------------
// Mocks — vóór imports van de geteste module instellen
// ---------------------------------------------------------------------------

// Mock Sentry — start spans direct uitvoeren
vi.mock("@sentry/node", () => ({
  startSpan: vi.fn(
    (_opts: unknown, fn: () => Promise<unknown>) => fn(),
  ),
  captureException: vi.fn(),
}));

// Mock Redis-instantie
const mockRedisGet = vi.fn<(key: string) => Promise<string | null>>();
const mockRedisSet = vi.fn<(key: string, value: string, exMode: string, ttl: number) => Promise<"OK">>();
const mockRedisDel = vi.fn<(key: string) => Promise<number>>();

vi.mock("~/lib/redis.server", () => ({
  redis: {
    get: (key: string) => mockRedisGet(key),
    set: (key: string, value: string, exMode: string, ttl: number) => mockRedisSet(key, value, exMode, ttl),
    del: (key: string) => mockRedisDel(key),
  } as unknown as Redis,
}));

// Mock globalThis.fetch
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Import module NADAT mocks zijn ingesteld
// ---------------------------------------------------------------------------
import {
  getShopifyAdminToken,
  invalidateShopifyAdminToken,
  ShopifyAuthFout,
  REDIS_KEY,
  SAFETY_MARGIN_MS,
  _resetTokenManagerVoorTests,
  type TokenInfo,
} from "./shopify-token-manager.server.js";

// ---------------------------------------------------------------------------
// Testhelpers
// ---------------------------------------------------------------------------

function maakTokenInfo(opties: {
  accessToken?: string;
  expiresOverMs?: number;
}): TokenInfo {
  return {
    accessToken: opties.accessToken ?? "shpat_testtoken123",
    expiresAt: Date.now() + (opties.expiresOverMs ?? 60 * 60 * 1000), // standaard 1u
  };
}

function maakSuccesvolleOAuthRespons(opties: {
  accessToken?: string;
  expiresIn?: number;
} = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: opties.accessToken ?? "shpat_vernieuwd_token",
      scope: "read_orders,write_returns",
      expires_in: opties.expiresIn ?? 86400,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const origineelEnv = { ...process.env };

function stelEnvIn(overrides: Record<string, string | undefined>): void {
  for (const [sleutel, waarde] of Object.entries(overrides)) {
    if (waarde === undefined) {
      delete process.env[sleutel];
    } else {
      process.env[sleutel] = waarde;
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetTokenManagerVoorTests();

  // Standaard: alle Shopify-env-variabelen aanwezig
  stelEnvIn({
    SHOPIFY_API_KEY: "test-api-key",
    SHOPIFY_API_SECRET: "test-api-secret",
    SHOPIFY_SHOP_DOMAIN: "u17s8e-sc.myshopify.com",
    SHOPIFY_ADMIN_TOKEN: "shpat_statisch_token",
  });

  // Standaard: Redis heeft geen gecachte token
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue("OK");
  mockRedisDel.mockResolvedValue(1);
});

afterEach(() => {
  // Herstel process.env
  for (const sleutel of Object.keys(process.env)) {
    if (!(sleutel in origineelEnv)) {
      delete process.env[sleutel];
    }
  }
  Object.assign(process.env, origineelEnv);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getShopifyAdminToken()", () => {
  // -------------------------------------------------------------------------
  // Gecachte token retourneren
  // -------------------------------------------------------------------------

  describe("Gecachte token (Redis hit)", () => {
    it("retourneert de gecachte token als die ruim voor verlopen is", async () => {
      const tokenInfo = maakTokenInfo({ expiresOverMs: 2 * 60 * 60 * 1000 }); // 2u
      mockRedisGet.mockResolvedValue(JSON.stringify(tokenInfo));

      const token = await getShopifyAdminToken();

      expect(token).toBe(tokenInfo.accessToken);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("controleert Redis vóór een vernieuwing te starten", async () => {
      const tokenInfo = maakTokenInfo({ expiresOverMs: 60 * 60 * 1000 }); // 1u
      mockRedisGet.mockResolvedValue(JSON.stringify(tokenInfo));

      await getShopifyAdminToken();

      expect(mockRedisGet).toHaveBeenCalledWith(REDIS_KEY);
    });
  });

  // -------------------------------------------------------------------------
  // Token vernieuwen binnen veiligheidsmarge
  // -------------------------------------------------------------------------

  describe("Token vernieuwen (bijna verlopen of niet in cache)", () => {
    it("vernieuwt token als TTL binnen SAFETY_MARGIN_MS valt", async () => {
      // Token verloopt over 3 minuten — kleiner dan SAFETY_MARGIN_MS (5 min)
      const tokenInfo = maakTokenInfo({ expiresOverMs: 3 * 60 * 1000 });
      mockRedisGet.mockResolvedValue(JSON.stringify(tokenInfo));
      mockFetch.mockResolvedValue(maakSuccesvolleOAuthRespons());

      const token = await getShopifyAdminToken();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(token).toBe("shpat_vernieuwd_token");
    });

    it("vernieuwt token als Redis leeg is (geen cache)", async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue(maakSuccesvolleOAuthRespons());

      const token = await getShopifyAdminToken();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(token).toBe("shpat_vernieuwd_token");
    });

    it("slaat vernieuwd token op in Redis met correcte TTL", async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue(
        maakSuccesvolleOAuthRespons({ expiresIn: 86400 }),
      );

      await getShopifyAdminToken();

      expect(mockRedisSet).toHaveBeenCalledWith(
        REDIS_KEY,
        expect.any(String),
        "EX",
        86400 - 60, // expires_in - 60 seconden
      );
    });

    it("stuurt correcte OAuth2 client_credentials verzoek naar Shopify", async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue(maakSuccesvolleOAuthRespons());

      await getShopifyAdminToken();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://u17s8e-sc.myshopify.com/admin/oauth/access_token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            client_id: "test-api-key",
            client_secret: "test-api-secret",
            grant_type: "client_credentials",
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Terugvalpad: statisch SHOPIFY_ADMIN_TOKEN
  // -------------------------------------------------------------------------

  describe("Terugvalpad — statisch SHOPIFY_ADMIN_TOKEN", () => {
    it("retourneert statisch token als SHOPIFY_API_KEY niet is ingesteld", async () => {
      stelEnvIn({ SHOPIFY_API_KEY: undefined });

      const token = await getShopifyAdminToken();

      expect(token).toBe("shpat_statisch_token");
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockRedisGet).not.toHaveBeenCalled();
    });

    it("retourneert statisch token als SHOPIFY_API_SECRET niet is ingesteld", async () => {
      stelEnvIn({ SHOPIFY_API_SECRET: undefined });

      const token = await getShopifyAdminToken();

      expect(token).toBe("shpat_statisch_token");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("gooit fout als geen enkele credential beschikbaar is", async () => {
      stelEnvIn({
        SHOPIFY_API_KEY: undefined,
        SHOPIFY_API_SECRET: undefined,
        SHOPIFY_ADMIN_TOKEN: undefined,
      });

      await expect(getShopifyAdminToken()).rejects.toThrow(
        /Geen Shopify-credentials geconfigureerd/,
      );
    });

    it("logt WARN-bericht bij terugval naar statisch token (slechts eenmaal)", async () => {
      stelEnvIn({ SHOPIFY_API_KEY: undefined });
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await getShopifyAdminToken();
      await getShopifyAdminToken(); // tweede aanroep

      // Waarschuwing slechts eenmaal gelogd (ongeacht aantal aanroepen)
      const waarschuwingen = stderrSpy.mock.calls.filter((args) => {
        const bericht = String(args[0]);
        return bericht.includes("shopify_token_statisch_terugval");
      });
      expect(waarschuwingen).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Thundering herd preventie (in-flight deduplicatie)
  // -------------------------------------------------------------------------

  describe("Gelijktijdige aanroepen — geen thundering herd", () => {
    it("deelt één in-flight vernieuwing bij meerdere gelijktijdige aanroepen", async () => {
      mockRedisGet.mockResolvedValue(null);

      // Simuleer vertraagde OAuth-respons (100ms) voor gelijktijdigheid
      let vertraging = 0;
      mockFetch.mockImplementation(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve(maakSuccesvolleOAuthRespons()), vertraging);
          vertraging = 0; // reset voor volgende aanroep
        }),
      );

      // Start 5 gelijktijdige aanroepen
      const resultaten = await Promise.all([
        getShopifyAdminToken(),
        getShopifyAdminToken(),
        getShopifyAdminToken(),
        getShopifyAdminToken(),
        getShopifyAdminToken(),
      ]);

      // Slechts één fetch-aanroep — alle anderen wachten op de in-flight belofte
      expect(mockFetch).toHaveBeenCalledOnce();

      // Alle aanroepen retourneren hetzelfde token
      for (const token of resultaten) {
        expect(token).toBe("shpat_vernieuwd_token");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Foutafhandeling — 5xx infrastructuurfouten
  // -------------------------------------------------------------------------

  describe("5xx respons — infrastructuurfout", () => {
    it("gooit fout bij 500 respons van Shopify OAuth", async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue(
        new Response("Internal Server Error", { status: 500 }),
      );

      await expect(getShopifyAdminToken()).rejects.toThrow(
        /Shopify OAuth mislukt — HTTP 500/,
      );
    });

    it("gooit fout bij 503 respons van Shopify OAuth", async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue(
        new Response("Service Unavailable", { status: 503 }),
      );

      await expect(getShopifyAdminToken()).rejects.toThrow(ShopifyAuthFout);
    });

    it("gooit fout bij netwerkfout (fetch werpt uitzondering)", async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(getShopifyAdminToken()).rejects.toThrow(
        /Shopify OAuth-eindpunt niet bereikbaar/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Foutafhandeling — 4xx authenticatiefouten
  // -------------------------------------------------------------------------

  describe("4xx respons — authenticatiefout", () => {
    it("gooit ShopifyAuthFout bij 401 respons van Shopify OAuth", async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue(
        new Response('{"error":"invalid_client"}', { status: 401 }),
      );

      const fout = await getShopifyAdminToken().catch((e) => e);

      expect(fout).toBeInstanceOf(ShopifyAuthFout);
      expect(fout.statusCode).toBe(401);
    });

    it("gooit ShopifyAuthFout bij 403 respons van Shopify OAuth", async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue(
        new Response('{"error":"forbidden"}', { status: 403 }),
      );

      await expect(getShopifyAdminToken()).rejects.toThrow(ShopifyAuthFout);
    });
  });
});

// ---------------------------------------------------------------------------
// invalidateShopifyAdminToken()
// ---------------------------------------------------------------------------

describe("invalidateShopifyAdminToken()", () => {
  it("verwijdert token uit Redis", async () => {
    await invalidateShopifyAdminToken();

    expect(mockRedisDel).toHaveBeenCalledWith(REDIS_KEY);
  });

  it("dwingt vernieuwing af bij volgende getShopifyAdminToken()-aanroep", async () => {
    // Stap 1: cache gevuld
    const versTokenInfo = maakTokenInfo({ expiresOverMs: 2 * 60 * 60 * 1000 });
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(versTokenInfo));

    const eersteToken = await getShopifyAdminToken();
    expect(eersteToken).toBe(versTokenInfo.accessToken);
    expect(mockFetch).not.toHaveBeenCalled();

    // Stap 2: invalideer + volgende aanroep → vernieuwing
    await invalidateShopifyAdminToken();

    // Redis is nu leeg na invalidatie
    mockRedisGet.mockResolvedValueOnce(null);
    mockFetch.mockResolvedValue(
      maakSuccesvolleOAuthRespons({ accessToken: "shpat_na_invalidatie" }),
    );

    const tweedeToken = await getShopifyAdminToken();

    expect(tweedeToken).toBe("shpat_na_invalidatie");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("logt INFO bij succesvolle invalidatie", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await invalidateShopifyAdminToken();

    const logs = stdoutSpy.mock.calls.filter((args) =>
      String(args[0]).includes("shopify_token_geinvalideerd"),
    );
    expect(logs).toHaveLength(1);
  });

  it("logt WARN maar gooit geen fout als Redis-del mislukt", async () => {
    mockRedisDel.mockRejectedValue(new Error("Redis ECONNRESET"));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // Mag geen fout gooien
    await expect(invalidateShopifyAdminToken()).resolves.toBeUndefined();

    const warns = stderrSpy.mock.calls.filter((args) =>
      String(args[0]).includes("shopify_token_invalidatie_fout"),
    );
    expect(warns).toHaveLength(1);
  });
});

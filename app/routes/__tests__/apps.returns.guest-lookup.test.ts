/**
 * Integratietests voor POST /apps/returns/guest-lookup
 *
 * Dekt:
 * - Happy path: bestelling gevonden, token gegenereerd
 * - Bestelling niet gevonden → 200 { found: false }
 * - E-mailadres mismatch → 200 { found: false }
 * - Rate limiting: 5 pogingen dan 429
 * - HMAC-handtekening ontbreekt → 401
 * - Idempotency replay
 * - Idempotency endpoint-mismatch
 * - Validatiefout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------

const TEST_GEHEIM = "test-api-geheim-abcdefghijklmnopqrstuvwxyz123456";
const TEST_JWT_SECRET = "test-jwt-geheim-minimaal-32-tekens-lang-xxxxxxxxxx";

// ---------------------------------------------------------------------------
// Mock afhankelijkheden
// ---------------------------------------------------------------------------

const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn();
const mockDbTransaction = vi.fn();

vi.mock("../../../db/index.js", () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
}));

vi.mock("../../../db/schema.js", () => ({
  returns: {},
  returnItems: {},
  returnStateHistory: {},
  idempotencyKeys: { key: "key", endpoint: "endpoint", expiresAt: "expires_at" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ op: "eq", a, b })),
  and: vi.fn((...args) => ({ op: "and", args })),
  gt: vi.fn((a, b) => ({ op: "gt", a, b })),
  inArray: vi.fn((col, vals) => ({ op: "inArray", col, vals })),
}));

// Mock Shopify queries
vi.mock("~/lib/shopify-queries.server", () => ({
  haalBestellingOpId: vi.fn(),
  haalBestellingOpNaamEnEmail: vi.fn(),
}));

// Mock eligibility (vermijdt DB-aanroepen in de eligibility engine)
vi.mock("~/services/eligibility", () => ({
  checkEligibility: vi.fn(),
}));

// Mock Sentry
vi.mock("@sentry/node", () => ({
  startSpan: vi.fn(async (_opts, fn) => fn()),
  captureException: vi.fn(),
}));

// Mock rate limiter — aanpasbaar per test
const mockControleerRateLimit = vi.fn();
vi.mock("~/lib/rate-limiter.server", () => ({
  controleerRateLimit: mockControleerRateLimit,
  extracteerClientIp: vi.fn().mockReturnValue("192.168.1.1"),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maakHandtekening(params: Record<string, string>, geheim: string): string {
  const canoniek = Object.keys(params)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => `${k}=${params[k] ?? ""}`)
    .join("");
  return createHmac("sha256", geheim).update(canoniek, "utf8").digest("hex");
}

function maakQueryString(): string {
  const params: Record<string, string> = {
    shop: "test.myshopify.com",
    path_prefix: "/apps/returns",
    timestamp: String(Math.floor(Date.now() / 1000)),
    // Geen logged_in_customer_id — gast
  };
  params["signature"] = maakHandtekening(params, TEST_GEHEIM);
  return new URLSearchParams(params).toString();
}

function maakRequest(body: unknown, geldigeHandtekening = true): Request {
  const qs = geldigeHandtekening ? maakQueryString() : "shop=test.myshopify.com";
  return new Request(`https://shop.example.com/apps/returns/guest-lookup?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function maakMockBestelling() {
  return {
    id: "gid://shopify/Order/12345",
    name: "#1042",
    customerEmail: "klant@voorbeeld.nl",
    customerId: null,
    financialStatus: "paid",
    fulfillmentStatus: "fulfilled",
    fulfillments: [{ createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), deliveredAt: null }],
    lineItems: [{
      id: "gid://shopify/LineItem/111",
      variantId: "gid://shopify/ProductVariant/222",
      productId: "gid://shopify/Product/333",
      productTitle: "JANICE Blazer",
      variantTitle: "Camel / M",
      sku: "JAB-CAM-M",
      productType: "blazer",
      tags: [],
      quantity: 1,
      originalUnitPrice: "189.95",
      discountedUnitPrice: "189.95",
      compareAtPrice: null,
      metafields: [],
    }],
  };
}

function setupIdempotencyMock(bestaandeSleutel?: { endpoint: string; responseStatus: number; responseBody: unknown; expiresAt: Date }) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(bestaandeSleutel ? [bestaandeSleutel] : []),
  };
  mockDbSelect.mockReturnValue(selectChain);

  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
  mockDbInsert.mockReturnValue(insertChain);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /apps/returns/guest-lookup", () => {
  beforeEach(() => {
    process.env["SHOPIFY_API_SECRET"] = TEST_GEHEIM;
    process.env["JWT_SECRET"] = TEST_JWT_SECRET;
    process.env["REDIS_URL"] = "redis://localhost:6379";
    vi.clearAllMocks();

    // Standaard: rate limit niet overschreden
    mockControleerRateLimit.mockResolvedValue({
      overschreden: false,
      huidigAantal: 1,
      maxPogingen: 5,
      retryAfterSeconds: null,
    });
  });

  afterEach(() => {
    delete process.env["SHOPIFY_API_SECRET"];
    delete process.env["JWT_SECRET"];
    delete process.env["REDIS_URL"];
  });

  it("happy path: bestelling gevonden, token en eligibility teruggeven", async () => {
    const { haalBestellingOpNaamEnEmail } = await import("~/lib/shopify-queries.server");
    const { checkEligibility } = await import("~/services/eligibility");
    vi.mocked(haalBestellingOpNaamEnEmail).mockResolvedValue(maakMockBestelling());
    vi.mocked(checkEligibility).mockResolvedValue({
      eligible: true,
      reasons: [],
      windowDays: 30,
      windowExpiresAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
    });

    setupIdempotencyMock();

    const { action } = await import("../apps.returns.guest-lookup");
    const request = maakRequest({
      orderName: "#1042",
      email: "klant@voorbeeld.nl",
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(200);
    const lichaam = await reactie.json();
    expect(lichaam.found).toBe(true);
    expect(typeof lichaam.token).toBe("string");
    expect(lichaam).toHaveProperty("eligibility");
    expect(lichaam).toHaveProperty("lineItems");
  });

  it("200 found:false als bestelling niet gevonden", async () => {
    const { haalBestellingOpNaamEnEmail } = await import("~/lib/shopify-queries.server");
    vi.mocked(haalBestellingOpNaamEnEmail).mockResolvedValue(null);
    setupIdempotencyMock();

    const { action } = await import("../apps.returns.guest-lookup");
    const request = maakRequest({
      orderName: "#9999",
      email: "onbekend@voorbeeld.nl",
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(200);
    const lichaam = await reactie.json();
    expect(lichaam.found).toBe(false);
    // Controleer dat token NIET in het antwoord zit
    expect(lichaam.token).toBeUndefined();
  });

  it("429 bij overschreden rate limit", async () => {
    mockControleerRateLimit.mockResolvedValue({
      overschreden: true,
      huidigAantal: 6,
      maxPogingen: 5,
      retryAfterSeconds: 845,
    });

    const { action } = await import("../apps.returns.guest-lookup");
    const request = maakRequest({
      orderName: "#1042",
      email: "klant@voorbeeld.nl",
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(429);
    expect(reactie.headers.get("Retry-After")).toBe("845");
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("rate_limited");
  });

  it("401 bij ontbrekende HMAC-handtekening", async () => {
    const { action } = await import("../apps.returns.guest-lookup");
    const request = maakRequest({
      orderName: "#1042",
      email: "klant@voorbeeld.nl",
      idempotencyKey: crypto.randomUUID(),
    }, false); // Geen handtekening

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(401);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("signature_invalid");
  });

  it("idempotency replay: gecachet antwoord teruggeven", async () => {
    const idempotencySleutel = crypto.randomUUID();
    const vervalDatum = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // responseBody moet een plain JSON-object zijn (geen Date objecten)
    setupIdempotencyMock({
      endpoint: "POST /apps/returns/guest-lookup",
      responseStatus: 200,
      responseBody: { found: true, token: "bestaand.token.hier", eligibility: { eligible: true, reasons: [] }, lineItems: [] },
      expiresAt: vervalDatum,
    });

    const { action } = await import("../apps.returns.guest-lookup");
    const request = maakRequest({
      orderName: "#1042",
      email: "klant@voorbeeld.nl",
      idempotencyKey: idempotencySleutel,
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(200);
    const lichaam = await reactie.json();
    expect(lichaam.token).toBe("bestaand.token.hier"); // Gecachet
  });

  it("409 bij idempotency endpoint-mismatch", async () => {
    const idempotencySleutel = crypto.randomUUID();
    const vervalDatum = new Date(Date.now() + 24 * 60 * 60 * 1000);

    setupIdempotencyMock({
      endpoint: "POST /apps/returns/submit", // Ander endpoint!
      responseStatus: 200,
      responseBody: {},
      expiresAt: vervalDatum,
    });

    const { action } = await import("../apps.returns.guest-lookup");
    const request = maakRequest({
      orderName: "#1042",
      email: "klant@voorbeeld.nl",
      idempotencyKey: idempotencySleutel,
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(409);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("idempotency_key_reused_for_different_endpoint");
  });

  it("400 validatiefout bij ongeldig e-mailadres", async () => {
    setupIdempotencyMock();

    const { action } = await import("../apps.returns.guest-lookup");
    const request = maakRequest({
      orderName: "#1042",
      email: "geen-geldig-emailadres",
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(400);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("validation_failed");
  });

  it("400 validatiefout bij ongeldig bestelnummer formaat", async () => {
    setupIdempotencyMock();

    const { action } = await import("../apps.returns.guest-lookup");
    const request = maakRequest({
      orderName: "niet-een-nummer",
      email: "klant@voorbeeld.nl",
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(400);
  });

  it("200 found:false lekt geen informatie over bestelling-bestaan (timing)", async () => {
    // Test dat de responstijd minimaal MIN_REACTIETIJD_MS is
    const { haalBestellingOpNaamEnEmail } = await import("~/lib/shopify-queries.server");
    vi.mocked(haalBestellingOpNaamEnEmail).mockResolvedValue(null);

    setupIdempotencyMock();

    const { action } = await import("../apps.returns.guest-lookup");
    const startTijd = Date.now();

    const request = maakRequest({
      orderName: "#9999",
      email: "onbekend@voorbeeld.nl",
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    const verstreken = Date.now() - startTijd;

    expect(reactie.status).toBe(200);
    // Minimale vertraging van 200ms is aanwezig
    expect(verstreken).toBeGreaterThanOrEqual(190); // ~200ms met kleine marge
  });
});

/**
 * Integratietests voor POST /apps/returns/start
 *
 * Dekt:
 * - Happy path: DRAFT-retour aanmaken
 * - Handtekening ontbreekt/ongeldig → 401
 * - Gast zonder login → 401 guest_must_use_lookup
 * - Idempotency replay → zelfde response, cached=true
 * - Idempotency endpoint-mismatch → 409
 * - Bestelling van een andere klant → 403 order_not_yours
 * - Final-sale artikel → 422 eligible=false
 * - Verlopen retourvenster → 422 eligible=false
 * - Validatiefout (ontbrekende velden) → 400
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// ---------------------------------------------------------------------------
// Omgevingsvariabelen voor tests
// ---------------------------------------------------------------------------

const TEST_GEHEIM = "test-api-geheim-abcdefghijklmnopqrstuvwxyz123456";
const TEST_JWT_SECRET = "test-jwt-geheim-minimaal-32-tekens-lang-xxxxxxxxxx";
const TEST_CUSTOMER_ID = "gid://shopify/Customer/99999";

// ---------------------------------------------------------------------------
// Mock alle externe afhankelijkheden
// ---------------------------------------------------------------------------

// Mock DB
const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn();
const mockDbTransaction = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock("../../../db/index.js", () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
    transaction: mockDbTransaction,
    update: mockDbUpdate,
  },
}));

vi.mock("../../../db/schema.js", () => ({
  returns: { id: "id", customerId: "customer_id", state: "state" },
  returnItems: {},
  returnStateHistory: {},
  idempotencyKeys: { key: "key", endpoint: "endpoint", expiresAt: "expires_at" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ op: "eq", a, b })),
  and: vi.fn((...args) => ({ op: "and", args })),
  gt: vi.fn((a, b) => ({ op: "gt", a, b })),
  desc: vi.fn((col) => ({ op: "desc", col })),
  inArray: vi.fn((col, vals) => ({ op: "inArray", col, vals })),
}));

// Mock Shopify client
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

// Mock rate limiter
vi.mock("~/lib/rate-limiter.server", () => ({
  controleerRateLimit: vi.fn().mockResolvedValue({ overschreden: false, huidigAantal: 1, maxPogingen: 5, retryAfterSeconds: null }),
  extracteerClientIp: vi.fn().mockReturnValue("127.0.0.1"),
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

function maakQueryString(extraParams: Record<string, string> = {}, metKlant = true): string {
  const params: Record<string, string> = {
    shop: "test.myshopify.com",
    path_prefix: "/apps/returns",
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(metKlant ? { logged_in_customer_id: TEST_CUSTOMER_ID } : {}),
    ...extraParams,
  };
  params["signature"] = maakHandtekening(params, TEST_GEHEIM);
  return new URLSearchParams(params).toString();
}

function maakRequest(body: unknown, metKlant = true, geldigeHandtekening = true): Request {
  const qs = geldigeHandtekening ? maakQueryString({}, metKlant) : "shop=test.myshopify.com";
  return new Request(`https://shop.example.com/apps/returns/start?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function maakMockBestelling(klantId = TEST_CUSTOMER_ID) {
  return {
    id: "gid://shopify/Order/12345",
    name: "#1042",
    customerEmail: "klant@voorbeeld.nl",
    customerId: klantId,
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
      quantity: 2,
      originalUnitPrice: "189.95",
      discountedUnitPrice: "189.95",
      compareAtPrice: null,
      metafields: [],
    }],
  };
}

// Mock idempotency
const idempotencyStore = new Map<string, { endpoint: string; status: number; body: unknown; expiresAt: Date }>();

function maakSelectChain(resultaat: unknown[] = []) {
  // Chain die zowel .limit() als directe resolving ondersteunt (voor eligibility DB-queries)
  const chain: Record<string, unknown> = {};
  const resolver = vi.fn().mockResolvedValue(resultaat);
  chain["from"] = vi.fn().mockReturnValue(chain);
  chain["where"] = vi.fn().mockReturnValue(chain);
  chain["limit"] = resolver;
  chain["then"] = (resolve: (val: unknown[]) => void) => Promise.resolve(resultaat).then(resolve);
  return chain;
}

function setupIdempotencyMock(bestaandeSleutel?: { endpoint: string; responseStatus: number; responseBody: unknown; expiresAt: Date }) {
  // Eerste call: idempotency-lookup; volgende calls: eligibility engine (alGeretourneerd etc.)
  let callCount = 0;
  mockDbSelect.mockImplementation(() => {
    callCount++;
    const resultaat = callCount === 1 && bestaandeSleutel ? [bestaandeSleutel] : [];
    return maakSelectChain(resultaat);
  });

  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
  mockDbInsert.mockReturnValue(insertChain);

  mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const txInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    await fn({ insert: txInsert, update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) }) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /apps/returns/start", () => {
  beforeEach(() => {
    process.env["SHOPIFY_API_SECRET"] = TEST_GEHEIM;
    process.env["JWT_SECRET"] = TEST_JWT_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env["SHOPIFY_API_SECRET"];
    delete process.env["JWT_SECRET"];
  });

  it("happy path: maakt DRAFT-retour aan en geeft 201 terug", async () => {
    const { haalBestellingOpId } = await import("~/lib/shopify-queries.server");
    const { checkEligibility } = await import("~/services/eligibility");
    vi.mocked(haalBestellingOpId).mockResolvedValue(maakMockBestelling());
    vi.mocked(checkEligibility).mockResolvedValue({
      eligible: true,
      reasons: [],
      windowDays: 30,
      windowExpiresAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
    });

    setupIdempotencyMock();

    const { action } = await import("../apps.returns.start");
    const request = maakRequest({
      shopifyOrderId: "gid://shopify/Order/12345",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(201);

    const lichaam = await reactie.json();
    expect(lichaam).toHaveProperty("id");
    expect(lichaam.state).toBe("DRAFT");
    expect(lichaam).toHaveProperty("totalRefundAmount");
    expect(lichaam).toHaveProperty("windowExpiresAt");
  });

  it("401 als HMAC-handtekening ontbreekt", async () => {
    const { action } = await import("../apps.returns.start");
    const request = maakRequest({
      shopifyOrderId: "gid://shopify/Order/12345",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      idempotencyKey: crypto.randomUUID(),
    }, true, false); // Geen handtekening

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(401);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("signature_invalid");
  });

  it("401 guest_must_use_lookup als klant niet ingelogd is", async () => {
    const { action } = await import("../apps.returns.start");
    const request = maakRequest({
      shopifyOrderId: "gid://shopify/Order/12345",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      idempotencyKey: crypto.randomUUID(),
    }, false); // Geen logged_in_customer_id

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(401);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("guest_must_use_lookup");
  });

  it("idempotency replay: zelfde sleutel geeft gecachet antwoord terug", async () => {
    const idempotencySleutel = crypto.randomUUID();
    const vervalDatum = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // responseBody moet een plain JSON-object zijn (geen Date objecten)
    const gecachteBody = { id: "bestaand-retour", state: "DRAFT", totalRefundAmount: "189.95", items: [], windowExpiresAt: new Date().toISOString() };

    setupIdempotencyMock({
      endpoint: "POST /apps/returns/start",
      responseStatus: 201,
      responseBody: gecachteBody,
      expiresAt: vervalDatum,
    });

    const { action } = await import("../apps.returns.start");
    const request = maakRequest({
      shopifyOrderId: "gid://shopify/Order/12345",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      idempotencyKey: idempotencySleutel,
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(201);
    const lichaam = await reactie.json();
    expect(lichaam.id).toBe("bestaand-retour"); // Gecachet antwoord
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

    const { action } = await import("../apps.returns.start");
    const request = maakRequest({
      shopifyOrderId: "gid://shopify/Order/12345",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      idempotencyKey: idempotencySleutel,
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(409);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("idempotency_key_reused_for_different_endpoint");
  });

  it("403 order_not_yours als bestelling van andere klant is", async () => {
    const { haalBestellingOpId } = await import("~/lib/shopify-queries.server");
    vi.mocked(haalBestellingOpId).mockResolvedValue(
      maakMockBestelling("gid://shopify/Customer/ANDER"), // Andere klant!
    );
    // checkEligibility wordt niet bereikt (403 eerder), maar mock voor veiligheid
    const { checkEligibility } = await import("~/services/eligibility");
    vi.mocked(checkEligibility).mockResolvedValue({ eligible: true, reasons: [], windowDays: 30, windowExpiresAt: null });

    setupIdempotencyMock();

    const { action } = await import("../apps.returns.start");
    const request = maakRequest({
      shopifyOrderId: "gid://shopify/Order/12345",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(403);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("order_not_yours");
  });

  it("422 eligible=false bij final-sale artikel", async () => {
    const { haalBestellingOpId } = await import("~/lib/shopify-queries.server");
    const { checkEligibility } = await import("~/services/eligibility");
    vi.mocked(haalBestellingOpId).mockResolvedValue(maakMockBestelling());
    vi.mocked(checkEligibility).mockResolvedValue({
      eligible: false,
      reasons: ["final_sale_not_returnable"],
      windowDays: 30,
      windowExpiresAt: null,
    });

    setupIdempotencyMock();

    const { action } = await import("../apps.returns.start");
    const request = maakRequest({
      shopifyOrderId: "gid://shopify/Order/12345",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(422);
    const lichaam = await reactie.json();
    expect(lichaam.eligible).toBe(false);
    expect(lichaam.reasons).toContain("final_sale_not_returnable");
  });

  it("422 eligible=false bij verlopen retourvenster", async () => {
    const { haalBestellingOpId } = await import("~/lib/shopify-queries.server");
    const { checkEligibility } = await import("~/services/eligibility");
    vi.mocked(haalBestellingOpId).mockResolvedValue(maakMockBestelling());
    vi.mocked(checkEligibility).mockResolvedValue({
      eligible: false,
      reasons: ["return_window_expired"],
      windowDays: 30,
      windowExpiresAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });

    setupIdempotencyMock();

    const { action } = await import("../apps.returns.start");
    const request = maakRequest({
      shopifyOrderId: "gid://shopify/Order/12345",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(422);
    const lichaam = await reactie.json();
    expect(lichaam.eligible).toBe(false);
    expect(lichaam.reasons).toContain("return_window_expired");
  });

  it("400 validatiefout bij ontbrekende verplichte velden", async () => {
    const { action } = await import("../apps.returns.start");
    const request = maakRequest({
      // Ontbrekend shopifyOrderId, lineItems, idempotencyKey
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(400);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("validation_failed");
  });

  it("400 validatiefout bij ongeldig Shopify GID formaat", async () => {
    const { action } = await import("../apps.returns.start");
    const request = maakRequest({
      shopifyOrderId: "12345", // Geen GID formaat
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(400);
  });
});

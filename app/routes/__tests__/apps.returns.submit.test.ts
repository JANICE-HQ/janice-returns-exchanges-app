/**
 * Integratietests voor POST /apps/returns/submit
 *
 * Dekt:
 * - Happy path: ingelogde klant, DRAFT → SUBMITTED
 * - Happy path: gast met geldige JWT
 * - HMAC-handtekening ontbreekt → 401
 * - Retour niet in DRAFT state → 409 invalid_state
 * - Retour van andere klant → 403 order_not_yours
 * - resolution_not_allowed_for_reason (COLOR_DIFFERENT met exchange)
 * - Ongeldig gast-JWT → 401
 * - Idempotency replay
 * - Idempotency endpoint-mismatch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------

const TEST_GEHEIM = "test-api-geheim-abcdefghijklmnopqrstuvwxyz123456";
const TEST_JWT_SECRET = "test-jwt-geheim-minimaal-32-tekens-lang-xxxxxxxxxx";
const TEST_CUSTOMER_ID = "gid://shopify/Customer/99999";

// ---------------------------------------------------------------------------
// Mock afhankelijkheden
// ---------------------------------------------------------------------------

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
  returnItems: { returnId: "return_id" },
  returnStateHistory: { returnId: "return_id" },
  idempotencyKeys: { key: "key", endpoint: "endpoint", expiresAt: "expires_at" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ op: "eq", a, b })),
  and: vi.fn((...args) => ({ op: "and", args })),
  gt: vi.fn((a, b) => ({ op: "gt", a, b })),
  desc: vi.fn((col) => ({ op: "desc", col })),
  inArray: vi.fn((col, vals) => ({ op: "inArray", col, vals })),
}));

// Mock Shopify queries
vi.mock("~/lib/shopify-queries.server", () => ({
  haalBestellingOpId: vi.fn(),
}));

// Mock eligibility
vi.mock("~/services/eligibility", () => ({
  checkEligibility: vi.fn().mockResolvedValue({
    eligible: true,
    reasons: [],
    windowDays: 30,
    windowExpiresAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
  }),
}));

// Mock state machine
vi.mock("~/services/return-state-machine", () => ({
  transition: vi.fn().mockResolvedValue({ id: "retour-123", state: "SUBMITTED" }),
  InvalidTransitionError: class InvalidTransitionError extends Error {
    constructor(from: string, to: string) {
      super(`Ongeldige transitie: ${from} → ${to}`);
      this.name = "InvalidTransitionError";
    }
  },
}));

// Mock Sentry
vi.mock("@sentry/node", () => ({
  startSpan: vi.fn(async (_opts, fn) => fn()),
  captureException: vi.fn(),
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

function maakQueryString(metKlant = true): string {
  const params: Record<string, string> = {
    shop: "test.myshopify.com",
    path_prefix: "/apps/returns",
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(metKlant ? { logged_in_customer_id: TEST_CUSTOMER_ID } : {}),
  };
  params["signature"] = maakHandtekening(params, TEST_GEHEIM);
  return new URLSearchParams(params).toString();
}

function maakRequest(body: unknown, metKlant = true, geldigeHandtekening = true): Request {
  const qs = geldigeHandtekening ? maakQueryString(metKlant) : "shop=test.myshopify.com";
  return new Request(`https://shop.example.com/apps/returns/submit?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupIdempotencyMock(bestaandeSleutel?: { endpoint: string; responseStatus: number; responseBody: unknown; expiresAt: Date }) {
  const selectMock = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(bestaandeSleutel ? [bestaandeSleutel] : []),
  };
  mockDbSelect.mockReturnValue(selectMock);

  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
  mockDbInsert.mockReturnValue(insertChain);

  mockDbUpdate.mockReturnValue({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  });

  mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const txInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    const txUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    });
    await fn({ insert: txInsert, update: txUpdate });
  });
}

function setupDbWithReturn(retourData: {
  id: string;
  customerId: string | null;
  state: string;
  customerEmail: string;
  shopifyOrderId?: string;
}, items: unknown[] = [
  {
    id: "item-1",
    returnId: "retour-123",
    shopifyLineItemId: "gid://shopify/LineItem/111",
    productTitle: "JANICE Blazer",
    quantity: 1,
    unitPrice: "189.95",
    unitCompareAtPrice: null,
  }
]) {
  // Sequence van select calls:
  // 1. Idempotency check → []
  // 2. Return ophalen → [retourData]
  // 3. Return items ophalen → [items]
  let callCount = 0;

  mockDbSelect.mockImplementation(() => {
    callCount++;
    const results: unknown[] =
      callCount === 1 ? [] :       // idempotency check
      callCount === 2 ? [retourData] : // return ophalen
      items;                         // items ophalen
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(results),
    };
  });

  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
  mockDbInsert.mockReturnValue(insertChain);

  mockDbUpdate.mockReturnValue({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  });

  mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const txInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    const txUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) });
    await fn({ insert: txInsert, update: txUpdate });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /apps/returns/submit", () => {
  beforeEach(() => {
    process.env["SHOPIFY_API_SECRET"] = TEST_GEHEIM;
    process.env["JWT_SECRET"] = TEST_JWT_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env["SHOPIFY_API_SECRET"];
    delete process.env["JWT_SECRET"];
  });

  it("happy path: ingelogde klant dient retour in, state wordt SUBMITTED", async () => {
    setupDbWithReturn({
      id: "retour-123",
      customerId: TEST_CUSTOMER_ID,
      state: "DRAFT",
      customerEmail: "klant@voorbeeld.nl",
    });

    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      returnId: "retour-123",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      resolution: "refund",
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(200);
    const lichaam = await reactie.json();
    expect(lichaam.id).toBe("retour-123");
    expect(lichaam.state).toBe("SUBMITTED");
    expect(lichaam).toHaveProperty("totalRefundAmount");
  });

  it("401 bij ontbrekende HMAC-handtekening", async () => {
    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      returnId: "retour-123",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      resolution: "refund",
      idempotencyKey: crypto.randomUUID(),
    }, true, false);

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(401);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("signature_invalid");
  });

  it("409 invalid_state bij indiening van niet-DRAFT retour", async () => {
    setupDbWithReturn({
      id: "retour-123",
      customerId: TEST_CUSTOMER_ID,
      state: "SUBMITTED", // Al ingediend!
      customerEmail: "klant@voorbeeld.nl",
    });

    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      returnId: "retour-123",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      resolution: "refund",
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(409);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("invalid_state");
  });

  it("403 order_not_yours bij retour van andere klant", async () => {
    setupDbWithReturn({
      id: "retour-123",
      customerId: "gid://shopify/Customer/ANDER_KLANT", // Andere klant!
      state: "DRAFT",
      customerEmail: "anders@voorbeeld.nl",
    });

    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      returnId: "retour-123",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      resolution: "refund",
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(403);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("order_not_yours");
  });

  it("422 resolution_not_allowed_for_reason bij COLOR_DIFFERENT met exchange", async () => {
    setupDbWithReturn({
      id: "retour-123",
      customerId: TEST_CUSTOMER_ID,
      state: "DRAFT",
      customerEmail: "klant@voorbeeld.nl",
    });

    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      returnId: "retour-123",
      lineItems: [{
        shopifyLineItemId: "gid://shopify/LineItem/111",
        quantity: 1,
        reasonCode: "COLOR_DIFFERENT", // customerCanOverride=false, default=refund
      }],
      resolution: "exchange", // Niet toegestaan voor COLOR_DIFFERENT!
      exchangeForVariantId: "gid://shopify/ProductVariant/444",
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(422);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("resolution_not_allowed_for_reason");
  });

  it("422 resolution_not_allowed_for_reason bij DAMAGED met store_credit", async () => {
    setupDbWithReturn({
      id: "retour-123",
      customerId: TEST_CUSTOMER_ID,
      state: "DRAFT",
      customerEmail: "klant@voorbeeld.nl",
    });

    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      returnId: "retour-123",
      lineItems: [{
        shopifyLineItemId: "gid://shopify/LineItem/111",
        quantity: 1,
        reasonCode: "DAMAGED", // customerCanOverride=false
      }],
      resolution: "store_credit", // Niet toegestaan!
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(422);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("resolution_not_allowed_for_reason");
  });

  it("401 bij ongeldig gast-JWT", async () => {
    setupIdempotencyMock();

    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      guestToken: "dit.is.een.ongeldig.token",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      resolution: "refund",
      idempotencyKey: crypto.randomUUID(),
    }, false); // Gast — geen logged_in_customer_id

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(401);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("signature_invalid");
  });

  it("idempotency replay: gecachet antwoord teruggeven", async () => {
    const idempotencySleutel = crypto.randomUUID();
    const vervalDatum = new Date(Date.now() + 24 * 60 * 60 * 1000);

    setupIdempotencyMock({
      endpoint: "POST /apps/returns/submit",
      responseStatus: 200,
      responseBody: { id: "retour-123", state: "SUBMITTED", totalRefundAmount: "189.95", requiresOpsReview: false },
      expiresAt: vervalDatum,
    });

    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      returnId: "retour-123",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      resolution: "refund",
      idempotencyKey: idempotencySleutel,
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(200);
    const lichaam = await reactie.json();
    expect(lichaam.id).toBe("retour-123");
    expect(lichaam.state).toBe("SUBMITTED");
  });

  it("409 bij idempotency endpoint-mismatch", async () => {
    const idempotencySleutel = crypto.randomUUID();
    const vervalDatum = new Date(Date.now() + 24 * 60 * 60 * 1000);

    setupIdempotencyMock({
      endpoint: "POST /apps/returns/start", // Ander endpoint!
      responseStatus: 201,
      responseBody: {},
      expiresAt: vervalDatum,
    });

    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      returnId: "retour-123",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      resolution: "refund",
      idempotencyKey: idempotencySleutel,
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(409);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("idempotency_key_reused_for_different_endpoint");
  });

  it("400 validatiefout bij ontbrekende resolution", async () => {
    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      returnId: "retour-123",
      lineItems: [{ shopifyLineItemId: "gid://shopify/LineItem/111", quantity: 1, reasonCode: "CHANGED_MIND" }],
      // Ontbrekende resolution
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(400);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("validation_failed");
  });

  it("200 met requiresOpsReview=true voor DAMAGED redencode", async () => {
    setupDbWithReturn({
      id: "retour-123",
      customerId: TEST_CUSTOMER_ID,
      state: "DRAFT",
      customerEmail: "klant@voorbeeld.nl",
    });

    const { action } = await import("../apps.returns.submit");
    const request = maakRequest({
      returnId: "retour-123",
      lineItems: [{
        shopifyLineItemId: "gid://shopify/LineItem/111",
        quantity: 1,
        reasonCode: "DAMAGED", // requiresOpsReview=true
      }],
      resolution: "refund", // Default voor DAMAGED
      idempotencyKey: crypto.randomUUID(),
    });

    const reactie = await action({ request, params: {}, context: {} } as Parameters<typeof action>[0]);
    expect(reactie.status).toBe(200);
    const lichaam = await reactie.json();
    expect(lichaam.requiresOpsReview).toBe(true);
  });
});

// Einde tests — setupIdempotencyMock is al gedefinieerd bovenaan het bestand

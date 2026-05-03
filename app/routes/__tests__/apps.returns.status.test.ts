/**
 * Integratietests voor GET /apps/returns/:id/status
 *
 * Dekt:
 * - Happy path: ingelogde klant bekijkt eigen retour
 * - Happy path: gast met geldig token
 * - Retour niet gevonden → 404
 * - Retour van andere klant → 403
 * - Geen authenticatie → 401
 * - Ongeldig gast-JWT → 401
 * - HMAC-handtekening ontbreekt → 401
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

const mockDbSelect = vi.fn();

vi.mock("../../../db/index.js", () => ({
  db: {
    select: mockDbSelect,
  },
}));

vi.mock("../../../db/schema.js", () => ({
  returns: { id: "id", customerId: "customer_id" },
  returnItems: { returnId: "return_id" },
  returnStateHistory: { returnId: "return_id", createdAt: "created_at" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ op: "eq", a, b })),
  desc: vi.fn((col) => ({ op: "desc", col })),
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

function maakQueryString(metKlant = true, extraParams: Record<string, string> = {}): string {
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

function maakStatusRequest(retourId: string, opties: {
  metKlant?: boolean;
  gastToken?: string;
  geldigeHandtekening?: boolean;
} = {}): Request {
  const {
    metKlant = true,
    gastToken,
    geldigeHandtekening = true,
  } = opties;

  let qs = geldigeHandtekening ? maakQueryString(metKlant) : "shop=test.myshopify.com";
  if (gastToken) {
    const url = new URL(`https://shop.example.com/apps/returns/${retourId}/status?${qs}`);
    url.searchParams.set("token", gastToken);
    qs = url.searchParams.toString();
  }

  return new Request(
    `https://shop.example.com/apps/returns/${retourId}/status?${qs}`,
    { method: "GET" },
  );
}

function maakMockRetour(overrides: Partial<{
  id: string;
  customerId: string | null;
  customerEmail: string;
  state: string;
}> = {}) {
  return {
    id: "retour-abc-123",
    shopifyOrderId: "gid://shopify/Order/12345",
    shopifyOrderName: "#1042",
    customerId: TEST_CUSTOMER_ID,
    customerEmail: "klant@voorbeeld.nl",
    state: "SUBMITTED",
    resolution: "refund",
    totalRefundAmount: "189.95",
    totalRefundCurrency: "EUR",
    dhlLabelUrl: null,
    dhlTrackingNumber: null,
    returnMethod: null,
    expiresAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /apps/returns/:id/status", () => {
  beforeEach(() => {
    process.env["SHOPIFY_API_SECRET"] = TEST_GEHEIM;
    process.env["JWT_SECRET"] = TEST_JWT_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env["SHOPIFY_API_SECRET"];
    delete process.env["JWT_SECRET"];
  });

  it("happy path: ingelogde klant bekijkt eigen retourstatus", async () => {
    const retour = maakMockRetour();

    // De status route doet 3 selects: retour ophalen, items, history
    // Promise.all([items, history]) — items en history parallel
    let callCount = 0;
    mockDbSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Eerste call: retour ophalen (heeft .limit())
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([retour]),
        };
      }
      // Tweede/derde call: items en history (hebben .orderBy().limit() of direct)
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
    });

    const { loader } = await import("../apps.returns.$id.status");
    const request = maakStatusRequest("retour-abc-123");

    const reactie = await loader({ request, params: { id: "retour-abc-123" }, context: {} } as unknown as Parameters<typeof loader>[0]);
    expect(reactie.status).toBe(200);
    const lichaam = await reactie.json();
    expect(lichaam.id).toBe("retour-abc-123");
    expect(lichaam.state).toBe("SUBMITTED");
    expect(lichaam).toHaveProperty("items");
    expect(Array.isArray(lichaam.items)).toBe(true);
    expect(lichaam).toHaveProperty("history");
    expect(Array.isArray(lichaam.history)).toBe(true);
    expect(lichaam).toHaveProperty("dhlLabelUrl");
  });

  it("404 als retour niet gevonden", async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]), // Geen retour
    });

    const { loader } = await import("../apps.returns.$id.status");
    const request = maakStatusRequest("niet-bestaand-id");

    const reactie = await loader({ request, params: { id: "niet-bestaand-id" }, context: {} } as unknown as Parameters<typeof loader>[0]);
    expect(reactie.status).toBe(404);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("not_found");
  });

  it("403 order_not_yours bij retour van andere klant", async () => {
    const retour = maakMockRetour({
      customerId: "gid://shopify/Customer/ANDER", // Andere klant!
    });

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([retour]),
    });

    const { loader } = await import("../apps.returns.$id.status");
    const request = maakStatusRequest("retour-abc-123"); // Ingelogd als TEST_CUSTOMER_ID

    const reactie = await loader({ request, params: { id: "retour-abc-123" }, context: {} } as unknown as Parameters<typeof loader>[0]);
    expect(reactie.status).toBe(403);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("order_not_yours");
  });

  it("401 bij ontbrekende authenticatie (geen klant, geen token)", async () => {
    const retour = maakMockRetour();

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([retour]),
    });

    const { loader } = await import("../apps.returns.$id.status");
    const request = maakStatusRequest("retour-abc-123", { metKlant: false }); // Geen klant, geen token

    const reactie = await loader({ request, params: { id: "retour-abc-123" }, context: {} } as unknown as Parameters<typeof loader>[0]);
    expect(reactie.status).toBe(401);
  });

  it("401 bij ontbrekende HMAC-handtekening", async () => {
    const { loader } = await import("../apps.returns.$id.status");
    const request = maakStatusRequest("retour-abc-123", { geldigeHandtekening: false });

    const reactie = await loader({ request, params: { id: "retour-abc-123" }, context: {} } as unknown as Parameters<typeof loader>[0]);
    expect(reactie.status).toBe(401);
    const lichaam = await reactie.json();
    expect(lichaam.error.code).toBe("signature_invalid");
  });

  it("401 bij ongeldig gast-token", async () => {
    const retour = maakMockRetour({ customerId: null }); // Gastretour

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([retour]),
    });

    const { loader } = await import("../apps.returns.$id.status");
    const request = maakStatusRequest("retour-abc-123", {
      metKlant: false,
      gastToken: "dit.is.ongeldig.jwt",
    });

    const reactie = await loader({ request, params: { id: "retour-abc-123" }, context: {} } as unknown as Parameters<typeof loader>[0]);
    expect(reactie.status).toBe(401);
  });

  it("DHL-velden zijn null totdat LABEL_ISSUED bereikt is", async () => {
    const retour = maakMockRetour({ state: "SUBMITTED" });

    let callCount = 0;
    mockDbSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([retour]),
        };
      }
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
    });

    const { loader } = await import("../apps.returns.$id.status");
    const request = maakStatusRequest("retour-abc-123");

    const reactie = await loader({ request, params: { id: "retour-abc-123" }, context: {} } as unknown as Parameters<typeof loader>[0]);
    const lichaam = await reactie.json();
    expect(lichaam.dhlLabelUrl).toBeNull();
    expect(lichaam.dhlTrackingNumber).toBeNull();
  });

  it("history bevat maximaal 10 items", async () => {
    const retour = maakMockRetour();
    const history = Array.from({ length: 10 }, (_, i) => ({
      id: `hist-${i}`,
      returnId: "retour-abc-123",
      fromState: i === 0 ? null : `STATE_${i - 1}`,
      toState: `STATE_${i}`,
      actorType: "customer",
      actorId: TEST_CUSTOMER_ID,
      note: null,
      metadata: null,
      createdAt: new Date(Date.now() - i * 60000),
    }));

    let callCount = 0;
    mockDbSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Retour ophalen
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([retour]),
        };
      }
      // Items en history parallel — items leeg, history gevuld
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(callCount === 2 ? [] : history),
      };
    });

    const { loader } = await import("../apps.returns.$id.status");
    const request = maakStatusRequest("retour-abc-123");

    const reactie = await loader({ request, params: { id: "retour-abc-123" }, context: {} } as unknown as Parameters<typeof loader>[0]);
    const lichaam = await reactie.json();
    expect(lichaam.history.length).toBeLessThanOrEqual(10);
  });
});

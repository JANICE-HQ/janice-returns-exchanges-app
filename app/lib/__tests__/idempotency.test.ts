/**
 * Tests voor de idempotentie-helper — JANICE Returns & Exchanges app
 *
 * Dekt:
 * - Happy path: eerste aanroep voert handler uit
 * - Replay: tweede aanroep met zelfde sleutel geeft gecachet resultaat
 * - Endpoint-mismatch: 409-fout
 * - Verlopen sleutel: behandeld als nieuw
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdempotencyMismatchFout } from "../idempotency.server";

// ---------------------------------------------------------------------------
// Mock de database (factory — geen top-level variabelen in vi.mock)
// ---------------------------------------------------------------------------

vi.mock("../../../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../../../db/schema.js", () => ({
  idempotencyKeys: {
    key: "key",
    endpoint: "endpoint",
    responseStatus: "response_status",
    responseBody: "response_body",
    expiresAt: "expires_at",
    createdAt: "created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, op: "eq" })),
  and: vi.fn((...args) => ({ args, op: "and" })),
  gt: vi.fn((col, val) => ({ col, val, op: "gt" })),
}));

// ---------------------------------------------------------------------------
// Test-fixtures
// ---------------------------------------------------------------------------

const ENDPOINT = "POST /apps/returns/start";
const MOCK_RESULTAAT = { id: "retour-123", state: "DRAFT" };

// ---------------------------------------------------------------------------
// Helper: maak een mock chain aan (binnen tests, niet buiten)
// ---------------------------------------------------------------------------

describe("withIdempotency", () => {
  // DB mock-referenties worden na import opgehaald
  let dbMock: { select: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Haal de gemockte db-referentie op na vi.mock hoisting
    const dbModule = await import("../../../db/index.js");
    dbMock = dbModule.db as unknown as typeof dbMock;
  });

  function maakSelectChain(resultaat: unknown[]) {
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(resultaat),
    };
  }

  function maakInsertChain() {
    return {
      values: vi.fn().mockReturnThis(),
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("voert handler uit en slaat resultaat op bij nieuwe sleutel", async () => {
    const sleutel = crypto.randomUUID();
    dbMock.select.mockReturnValue(maakSelectChain([]));
    dbMock.insert.mockReturnValue(maakInsertChain());

    const { withIdempotency } = await import("../idempotency.server");

    const handler = vi.fn().mockResolvedValue({
      status: 201,
      body: MOCK_RESULTAAT,
    });

    const resultaat = await withIdempotency(sleutel, ENDPOINT, 24, handler);

    expect(handler).toHaveBeenCalledOnce();
    expect(resultaat.status).toBe(201);
    expect(resultaat.body).toEqual(MOCK_RESULTAAT);
    expect(resultaat.cached).toBe(false);
  });

  it("geeft gecachet resultaat terug bij herhaalde aanroep met zelfde sleutel", async () => {
    const sleutel = crypto.randomUUID();
    const vervalDatum = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const bestaandeSleutel = {
      key: sleutel,
      endpoint: ENDPOINT,
      responseStatus: 201,
      responseBody: MOCK_RESULTAAT,
      expiresAt: vervalDatum,
      createdAt: new Date(),
    };

    dbMock.select.mockReturnValue(maakSelectChain([bestaandeSleutel]));

    const { withIdempotency } = await import("../idempotency.server");

    const handler = vi.fn().mockResolvedValue({
      status: 201,
      body: MOCK_RESULTAAT,
    });

    const resultaat = await withIdempotency(sleutel, ENDPOINT, 24, handler);

    // Handler mag NIET aangeroepen zijn (gecachet)
    expect(handler).not.toHaveBeenCalled();
    expect(resultaat.status).toBe(201);
    expect(resultaat.body).toEqual(MOCK_RESULTAAT);
    expect(resultaat.cached).toBe(true);
  });

  it("gooit IdempotencyMismatchFout bij endpoint-mismatch", async () => {
    const sleutel = crypto.randomUUID();
    const vervalDatum = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const bestaandeSleutel = {
      key: sleutel,
      endpoint: "POST /apps/returns/submit", // Ander endpoint!
      responseStatus: 200,
      responseBody: {},
      expiresAt: vervalDatum,
      createdAt: new Date(),
    };

    dbMock.select.mockReturnValue(maakSelectChain([bestaandeSleutel]));

    const { withIdempotency, IdempotencyMismatchFout } = await import("../idempotency.server");

    const handler = vi.fn().mockResolvedValue({ status: 201, body: {} });

    await expect(
      withIdempotency(sleutel, ENDPOINT, 24, handler),
    ).rejects.toThrow(IdempotencyMismatchFout);

    expect(handler).not.toHaveBeenCalled();
  });

  it("behandelt verlopen sleutel als nieuw en voert handler uit", async () => {
    const sleutel = crypto.randomUUID();
    const verlopenDatum = new Date(Date.now() - 1000); // 1 seconde geleden verlopen
    const verlopenSleutel = {
      key: sleutel,
      endpoint: ENDPOINT,
      responseStatus: 201,
      responseBody: MOCK_RESULTAAT,
      expiresAt: verlopenDatum,
      createdAt: new Date(),
    };

    dbMock.select.mockReturnValue(maakSelectChain([verlopenSleutel]));
    dbMock.insert.mockReturnValue(maakInsertChain());

    const { withIdempotency } = await import("../idempotency.server");

    const nieuweData = { id: "retour-999", state: "DRAFT" };
    const handler = vi.fn().mockResolvedValue({
      status: 201,
      body: nieuweData,
    });

    const resultaat = await withIdempotency(sleutel, ENDPOINT, 24, handler);

    expect(handler).toHaveBeenCalledOnce();
    expect(resultaat.body).toEqual(nieuweData);
    expect(resultaat.cached).toBe(false);
  });

  it("gooit IdempotencyMismatchFout ook bij verlopen sleutel met ander endpoint", async () => {
    const sleutel = crypto.randomUUID();
    const verlopenDatum = new Date(Date.now() - 1000);
    const verlopenSleutel = {
      key: sleutel,
      endpoint: "POST /apps/returns/submit",
      responseStatus: 200,
      responseBody: {},
      expiresAt: verlopenDatum,
      createdAt: new Date(),
    };

    dbMock.select.mockReturnValue(maakSelectChain([verlopenSleutel]));

    const { withIdempotency, IdempotencyMismatchFout } = await import("../idempotency.server");

    const handler = vi.fn().mockResolvedValue({ status: 201, body: {} });

    await expect(
      withIdempotency(sleutel, ENDPOINT, 24, handler),
    ).rejects.toThrow(IdempotencyMismatchFout);
  });
});

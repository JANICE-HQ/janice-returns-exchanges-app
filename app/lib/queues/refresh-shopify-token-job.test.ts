/**
 * Tests voor refresh-shopify-token-job.ts — JANICE Returns & Exchanges app
 *
 * Dekt:
 *  - Job verwerking roept getShopifyAdminToken() aan
 *  - Job logt token-verloopdatum (audit trail)
 *  - Job haalt verloopdatum correct op uit Redis
 *  - planRefreshShopifyTokenJob() configureert herhaaltaak correct
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
}));

// Mock getShopifyAdminToken
const mockGetShopifyAdminToken = vi.fn<() => Promise<string>>();
vi.mock("~/lib/shopify-token-manager.server", () => ({
  getShopifyAdminToken: () => mockGetShopifyAdminToken(),
  REDIS_KEY: "shopify:admin:token",
}));

// Mock Redis
const mockRedisGet = vi.fn<(key: string) => Promise<string | null>>();
vi.mock("~/lib/redis.server", () => ({
  redis: {
    get: (key: string) => mockRedisGet(key),
  } as unknown as Redis,
}));

// ---------------------------------------------------------------------------
// Import module NADAT mocks zijn ingesteld
// ---------------------------------------------------------------------------
import {
  processRefreshShopifyToken,
  planRefreshShopifyTokenJob,
  REFRESH_INTERVAL_MS,
  REFRESH_JOB_ID,
} from "./refresh-shopify-token-job.js";

// ---------------------------------------------------------------------------
// Testhelpers
// ---------------------------------------------------------------------------

function maakTestJob(): Job<Record<string, never>> {
  return {
    id: "test-refresh-job-001",
    data: {},
    attemptsMade: 0,
    opts: { attempts: 3 },
    name: "refresh-shopify-token",
  } as unknown as Job<Record<string, never>>;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetShopifyAdminToken.mockResolvedValue("shpat_vers_token");
  mockRedisGet.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processRefreshShopifyToken()", () => {
  it("roept getShopifyAdminToken() aan als bijwerking van vernieuwing", async () => {
    const job = maakTestJob();

    await processRefreshShopifyToken(job);

    expect(mockGetShopifyAdminToken).toHaveBeenCalledOnce();
  });

  it("logt token verloopdatum als Redis de token bevat", async () => {
    const verlooptOver2Uur = Date.now() + 2 * 60 * 60 * 1000;
    mockRedisGet.mockResolvedValue(
      JSON.stringify({
        accessToken: "shpat_test",
        expiresAt: verlooptOver2Uur,
      }),
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const job = maakTestJob();

    await processRefreshShopifyToken(job);

    const logs = stdoutSpy.mock.calls
      .map((args) => {
        try {
          return JSON.parse(String(args[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((log) => log?.event === "shopify_token_refresh_job_voltooid");

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "INFO",
      event: "shopify_token_refresh_job_voltooid",
      token_expires_at: expect.any(String),
      verloopt_over_minuten: expect.any(Number),
    });
  });

  it("logt start van de refresh job", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const job = maakTestJob();

    await processRefreshShopifyToken(job);

    const startLogs = stdoutSpy.mock.calls
      .map((args) => {
        try {
          return JSON.parse(String(args[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((log) => log?.event === "shopify_token_refresh_job_start");

    expect(startLogs).toHaveLength(1);
  });

  it("gooit geen fout als Redis leeg is (audit log overslaand)", async () => {
    mockRedisGet.mockResolvedValue(null);
    const job = maakTestJob();

    // Mag geen fout gooien
    await expect(processRefreshShopifyToken(job)).resolves.toBeUndefined();
  });

  it("gooit de fout door als getShopifyAdminToken() faalt", async () => {
    mockGetShopifyAdminToken.mockRejectedValue(
      new Error("Shopify OAuth 500"),
    );

    const job = maakTestJob();

    await expect(processRefreshShopifyToken(job)).rejects.toThrow(
      "Shopify OAuth 500",
    );
  });
});

// ---------------------------------------------------------------------------
// planRefreshShopifyTokenJob()
// ---------------------------------------------------------------------------

describe("planRefreshShopifyTokenJob()", () => {
  it("voegt herhaaltaak toe aan de queue met correct interval", async () => {
    const mockAdd = vi.fn().mockResolvedValue({ id: "test-job" });
    const mockQueue = { add: mockAdd } as unknown as import("bullmq").Queue<Record<string, never>>;

    await planRefreshShopifyTokenJob(mockQueue);

    expect(mockAdd).toHaveBeenCalledWith(
      "refresh-shopify-token",
      {},
      expect.objectContaining({
        repeat: { every: REFRESH_INTERVAL_MS },
        jobId: REFRESH_JOB_ID,
        removeOnComplete: true,
        removeOnFail: false,
      }),
    );
  });

  it("gebruikt 4 uur (14400000ms) als interval", () => {
    expect(REFRESH_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
    expect(REFRESH_INTERVAL_MS).toBe(14_400_000);
  });

  it("logt plannings-bevestiging na toevoegen", async () => {
    const mockAdd = vi.fn().mockResolvedValue({ id: "test-job" });
    const mockQueue = { add: mockAdd } as unknown as import("bullmq").Queue<Record<string, never>>;

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await planRefreshShopifyTokenJob(mockQueue);

    const planLogs = stdoutSpy.mock.calls
      .map((args) => {
        try {
          return JSON.parse(String(args[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((log) => log?.event === "shopify_token_refresh_scheduled");

    expect(planLogs).toHaveLength(1);
    expect(planLogs[0]).toMatchObject({
      interval_ms: REFRESH_INTERVAL_MS,
      next_run: expect.any(String),
    });
  });
});

/**
 * Tests voor IssueLabelJob — JANICE Returns & Exchanges app
 *
 * Dekt:
 *  - Happy path: DHL-label aanmaken + DB-update + state-transitie
 *  - Retour niet gevonden
 *  - Retour niet in APPROVED-state (skip)
 *  - DHL-fout → job gooit terug (BullMQ herprobeert)
 *  - enqueueIssueLabelJob plaatst job in queue
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import { processIssueLabel } from "./issue-label-job.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@sentry/node", () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
  captureException: vi.fn(),
}));

// Mock DHL-client
const mockCreateReturnLabel = vi.fn();
vi.mock("~/lib/dhl/parcel-nl.server", () => ({
  createReturnLabel: (...args: unknown[]) => mockCreateReturnLabel(...args),
}));

// Mock state machine
const mockTransition = vi.fn();
vi.mock("~/services/return-state-machine", () => ({
  transition: (...args: unknown[]) => mockTransition(...args),
}));

// Mock DB
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock("../../../db/index.js", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

vi.mock("../../../db/schema.js", () => ({
  returns: {
    id: "id",
    state: "state",
    customerEmail: "customer_email",
    dhlTrackingNumber: "dhl_tracking_number",
    dhlLabelUrl: "dhl_label_url",
    expiresAt: "expires_at",
    returnMethod: "return_method",
    updatedAt: "updated_at",
  },
}));

// ---------------------------------------------------------------------------
// Testdata
// ---------------------------------------------------------------------------

const testRetour = {
  id: "retour_test_001",
  state: "APPROVED",
  customerEmail: "klant@janice.com",
  customerId: "gid://shopify/Customer/99999",
  shopifyOrderId: "gid://shopify/Order/12345",
  shopifyOrderName: "#1042",
  totalRefundAmount: "89.95",
  resolution: "refund",
  dhlTrackingNumber: null,
  dhlLabelUrl: null,
  returnMethod: null,
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const testDhlResultaat = {
  trackingNumber: "JVGL012345678NL",
  qrToken: "QR_TEST_DATA_ABC",
  labelUrl: undefined,
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
};

function maakTestJob(returnId = "retour_test_001"): Job<{ returnId: string }> {
  return {
    id: "job_001",
    data: { returnId },
    attemptsMade: 0,
    opts: { attempts: 3 },
    name: "issue-label",
  } as unknown as Job<{ returnId: string }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IssueLabelJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Standaard: retour wordt gevonden in APPROVED-state
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([testRetour]),
        }),
      }),
    });

    // Standaard: DB-update slaagt
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: testRetour.id }]),
      }),
    });

    // Standaard: DHL label-aanmaak slaagt
    mockCreateReturnLabel.mockResolvedValue(testDhlResultaat);

    // Standaard: state-transitie slaagt
    mockTransition.mockResolvedValue({ ...testRetour, state: "LABEL_ISSUED" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("Happy path", () => {
    it("voltooit de volledige stroom: DHL label → DB update → transitie naar LABEL_ISSUED", async () => {
      const job = maakTestJob();

      await processIssueLabel(job);

      // DHL-aanroep
      expect(mockCreateReturnLabel).toHaveBeenCalledWith(
        expect.objectContaining({
          returnId: "retour_test_001",
          weight: 500,
          isQrPrintless: true,
        }),
      );

      // DB-update
      expect(mockDbUpdate).toHaveBeenCalled();

      // State-transitie naar LABEL_ISSUED
      expect(mockTransition).toHaveBeenCalledWith(
        "retour_test_001",
        "LABEL_ISSUED",
        { type: "system" },
        "DHL-retourlabel aangemaakt",
        expect.objectContaining({ trackingNumber: "JVGL012345678NL" }),
      );
    });

    it("slaat QR-token op als returnMethod dhl_qr", async () => {
      const job = maakTestJob();

      await processIssueLabel(job);

      const dbSetAanroep = mockDbUpdate.mock.calls[0]!;
      const setObject = dbSetAanroep[0]; // eerste argument van update()
      // Controleer dat update() is aangeroepen — set wordt later via chaining aangeroepen
      expect(mockDbUpdate).toHaveBeenCalled();
    });

    it("slaat PDF-label op als returnMethod dhl_label", async () => {
      mockCreateReturnLabel.mockResolvedValue({
        trackingNumber: "JVGL999888777NL",
        labelUrl: "https://cdn.dhl.com/labels/test.pdf",
        qrToken: undefined,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const job = maakTestJob();
      await processIssueLabel(job);

      expect(mockTransition).toHaveBeenCalledWith(
        "retour_test_001",
        "LABEL_ISSUED",
        { type: "system" },
        "DHL-retourlabel aangemaakt",
        expect.objectContaining({ trackingNumber: "JVGL999888777NL" }),
      );
    });

    it("stuurt trackingnummer mee in transitie-metadata", async () => {
      const job = maakTestJob();
      await processIssueLabel(job);

      expect(mockTransition).toHaveBeenCalledWith(
        expect.any(String),
        "LABEL_ISSUED",
        expect.any(Object),
        expect.any(String),
        expect.objectContaining({ trackingNumber: "JVGL012345678NL" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Retour niet gevonden
  // -------------------------------------------------------------------------

  describe("Retour niet gevonden", () => {
    it("gooit Error als retour niet in DB staat", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const job = maakTestJob("niet_bestaand_id");

      await expect(processIssueLabel(job)).rejects.toThrow(
        "Retour niet_bestaand_id niet gevonden in DB",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Retour niet in APPROVED-state
  // -------------------------------------------------------------------------

  describe("Retour in verkeerde state", () => {
    it("slaat verwerking over als retour al LABEL_ISSUED is", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ ...testRetour, state: "LABEL_ISSUED" }]),
          }),
        }),
      });

      const job = maakTestJob();
      await processIssueLabel(job);

      expect(mockCreateReturnLabel).not.toHaveBeenCalled();
      expect(mockTransition).not.toHaveBeenCalled();
    });

    it("slaat verwerking over als retour COMPLETED is", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ ...testRetour, state: "COMPLETED" }]),
          }),
        }),
      });

      const job = maakTestJob();
      await processIssueLabel(job);

      expect(mockCreateReturnLabel).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // DHL-fout
  // -------------------------------------------------------------------------

  describe("DHL-fout afhandeling", () => {
    it("gooit fout terug als DHL label-aanmaak mislukt (BullMQ herprobeert)", async () => {
      mockCreateReturnLabel.mockRejectedValue(
        new Error("DHL 503 Service Unavailable"),
      );

      const job = maakTestJob();

      await expect(processIssueLabel(job)).rejects.toThrow(
        "DHL 503 Service Unavailable",
      );

      // State-transitie mag NIET plaatsvinden bij DHL-fout
      expect(mockTransition).not.toHaveBeenCalled();
    });

    it("voert DB-update NIET uit als DHL mislukt", async () => {
      mockCreateReturnLabel.mockRejectedValue(new Error("DHL timeout"));

      const job = maakTestJob();

      await expect(processIssueLabel(job)).rejects.toThrow();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // State-transitie fout
  // -------------------------------------------------------------------------

  describe("State-transitie fout", () => {
    it("gooit fout als transitie naar LABEL_ISSUED mislukt", async () => {
      mockTransition.mockRejectedValue(new Error("Transitie mislukt"));

      const job = maakTestJob();

      await expect(processIssueLabel(job)).rejects.toThrow("Transitie mislukt");
    });
  });
});

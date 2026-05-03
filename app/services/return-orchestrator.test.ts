/**
 * Tests voor Return Orchestrator — JANICE Returns & Exchanges app
 *
 * Dekt:
 *  - Alle 9 side-effect routes (Klaviyo-events, BullMQ, Store Credit)
 *  - Fouttolerantie: side-effects mogen transitie NOOIT doen mislukken
 *  - Store Credit-aanroep bij resolution=store_credit op COMPLETED
 *  - Mollie/exchange stubbergedrag op COMPLETED
 *  - Klaviyo-fouten worden gelogd maar niet opgegooid
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  onStateTransition,
  type TransitionContext,
} from "./return-orchestrator.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@sentry/node", () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
  captureException: vi.fn(),
}));

const mockTrackEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/klaviyo/events.server", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

const mockCreditCustomer = vi.fn().mockResolvedValue({
  shopifyTransactionId: "gid://shopify/StoreCreditAccountTransaction/999",
  balanceAfter: 89.95,
});
vi.mock("~/lib/shopify/store-credit.server", () => ({
  creditCustomer: (...args: unknown[]) => mockCreditCustomer(...args),
}));

const mockEnqueueIssueLabelJob = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/queues/issue-label-job", () => ({
  enqueueIssueLabelJob: (...args: unknown[]) => mockEnqueueIssueLabelJob(...args),
}));

// Mock DB voor return_items-laad
const mockDbSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([
      { reasonCode: "CHANGED_MIND" },
    ]),
  }),
});

vi.mock("../../db/index.js", () => ({
  db: { select: (...args: unknown[]) => mockDbSelect(...args) },
}));

vi.mock("../../db/schema.js", () => ({
  returnItems: { reasonCode: "reason_code", returnId: "return_id" },
}));

// ---------------------------------------------------------------------------
// Testdata
// ---------------------------------------------------------------------------

const testContext: TransitionContext = {
  customerEmail: "klant@janice.com",
  customerId: "gid://shopify/Customer/99999",
  orderName: "#1042",
  totalRefundAmount: "89.95",
  resolution: "refund",
  reasonCodes: ["CHANGED_MIND"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Return Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrackEvent.mockResolvedValue(undefined);
    mockCreditCustomer.mockResolvedValue({
      shopifyTransactionId: "tx_123",
      balanceAfter: 89.95,
    });
    mockEnqueueIssueLabelJob.mockResolvedValue(undefined);
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ reasonCode: "CHANGED_MIND" }]),
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // SUBMITTED
  // -------------------------------------------------------------------------

  describe("* → SUBMITTED", () => {
    it("stuurt Return_Submitted Klaviyo-event", async () => {
      await onStateTransition("retour_001", "DRAFT", "SUBMITTED", testContext);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_Submitted" }),
      );
    });

    it("stuurt géén BullMQ-job bij SUBMITTED", async () => {
      await onStateTransition("retour_001", "DRAFT", "SUBMITTED", testContext);

      expect(mockEnqueueIssueLabelJob).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // APPROVED
  // -------------------------------------------------------------------------

  describe("SUBMITTED → APPROVED", () => {
    it("stuurt Return_Approved Klaviyo-event", async () => {
      await onStateTransition("retour_001", "SUBMITTED", "APPROVED", testContext);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_Approved" }),
      );
    });

    it("plaatst IssueLabelJob in BullMQ-queue", async () => {
      await onStateTransition("retour_001", "SUBMITTED", "APPROVED", testContext);

      expect(mockEnqueueIssueLabelJob).toHaveBeenCalledWith({ returnId: "retour_001" });
    });
  });

  // -------------------------------------------------------------------------
  // REJECTED
  // -------------------------------------------------------------------------

  describe("* → REJECTED", () => {
    it("stuurt Return_Rejected event bij SUBMITTED → REJECTED", async () => {
      await onStateTransition("retour_001", "SUBMITTED", "REJECTED", testContext);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_Rejected" }),
      );
    });

    it("stuurt Return_Rejected event bij INSPECTING → REJECTED", async () => {
      await onStateTransition("retour_001", "INSPECTING", "REJECTED", testContext);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_Rejected" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // LABEL_ISSUED
  // -------------------------------------------------------------------------

  describe("APPROVED → LABEL_ISSUED", () => {
    it("stuurt Return_Label_Issued event met trackingNumber", async () => {
      await onStateTransition(
        "retour_001",
        "APPROVED",
        "LABEL_ISSUED",
        { ...testContext, trackingNumber: "JVGL012345678NL" },
      );

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "Return_Label_Issued",
          properties: expect.objectContaining({
            tracking_number: "JVGL012345678NL",
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // IN_TRANSIT
  // -------------------------------------------------------------------------

  describe("LABEL_ISSUED → IN_TRANSIT", () => {
    it("stuurt Return_In_Transit event", async () => {
      await onStateTransition("retour_001", "LABEL_ISSUED", "IN_TRANSIT", testContext);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_In_Transit" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // RECEIVED
  // -------------------------------------------------------------------------

  describe("IN_TRANSIT → RECEIVED", () => {
    it("stuurt Return_Received event", async () => {
      await onStateTransition("retour_001", "IN_TRANSIT", "RECEIVED", testContext);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_Received" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // COMPLETED
  // -------------------------------------------------------------------------

  describe("INSPECTING → COMPLETED", () => {
    it("roept creditCustomer aan bij resolution=store_credit", async () => {
      await onStateTransition(
        "retour_001",
        "INSPECTING",
        "COMPLETED",
        { ...testContext, resolution: "store_credit", customerId: "gid://shopify/Customer/99999" },
      );

      expect(mockCreditCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: "gid://shopify/Customer/99999",
          amount: 89.95,
          currency: "EUR",
          returnId: "retour_001",
        }),
      );
    });

    it("stuurt Return_Completed event na creditering", async () => {
      await onStateTransition(
        "retour_001",
        "INSPECTING",
        "COMPLETED",
        { ...testContext, resolution: "store_credit" },
      );

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_Completed" }),
      );
    });

    it("roept GEEN creditCustomer aan bij resolution=refund", async () => {
      await onStateTransition(
        "retour_001",
        "INSPECTING",
        "COMPLETED",
        { ...testContext, resolution: "refund" },
      );

      expect(mockCreditCustomer).not.toHaveBeenCalled();
    });

    it("stuurt Return_Completed event ook bij resolution=refund (Mollie-stub)", async () => {
      await onStateTransition(
        "retour_001",
        "INSPECTING",
        "COMPLETED",
        { ...testContext, resolution: "refund" },
      );

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_Completed" }),
      );
    });

    it("stuurt Return_Completed event ook bij resolution=exchange (stub)", async () => {
      await onStateTransition(
        "retour_001",
        "INSPECTING",
        "COMPLETED",
        { ...testContext, resolution: "exchange" },
      );

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_Completed" }),
      );
    });

    it("slaat store_credit over als customerId ontbreekt (gast)", async () => {
      await onStateTransition(
        "retour_001",
        "INSPECTING",
        "COMPLETED",
        { ...testContext, resolution: "store_credit", customerId: null },
      );

      expect(mockCreditCustomer).not.toHaveBeenCalled();
      // Event wordt nog steeds gestuurd
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_Completed" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // EXPIRED
  // -------------------------------------------------------------------------

  describe("LABEL_ISSUED → EXPIRED", () => {
    it("stuurt Return_Expired event", async () => {
      await onStateTransition("retour_001", "LABEL_ISSUED", "EXPIRED", testContext);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "Return_Expired" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Fouttolerantie
  // -------------------------------------------------------------------------

  describe("Fouttolerantie", () => {
    it("gooit NIET als Klaviyo een fout retourneert", async () => {
      mockTrackEvent.mockRejectedValueOnce(new Error("Klaviyo 503 Service Unavailable"));

      // Mag niet gooien — side-effects mogen transitie NOOIT blokkeren
      await expect(
        onStateTransition("retour_001", "DRAFT", "SUBMITTED", testContext),
      ).resolves.toBeUndefined();
    });

    it("gooit NIET als BullMQ-enqueue mislukt", async () => {
      mockEnqueueIssueLabelJob.mockRejectedValueOnce(new Error("Redis verbinding mislukt"));

      await expect(
        onStateTransition("retour_001", "SUBMITTED", "APPROVED", testContext),
      ).resolves.toBeUndefined();
    });

    it("gooit NIET als Store Credit mislukt", async () => {
      mockCreditCustomer.mockRejectedValueOnce(new Error("Shopify API onbereikbaar"));

      await expect(
        onStateTransition(
          "retour_001",
          "INSPECTING",
          "COMPLETED",
          { ...testContext, resolution: "store_credit" },
        ),
      ).resolves.toBeUndefined();
    });

    it("rapporteert fouten naar Sentry", async () => {
      const sentryMock = await import("@sentry/node");
      mockTrackEvent.mockRejectedValueOnce(new Error("Klaviyo kapot"));

      await onStateTransition("retour_001", "DRAFT", "SUBMITTED", testContext);

      expect(sentryMock.captureException).toHaveBeenCalled();
    });

    it("verwerkt meerdere side-effects zelfs als de eerste mislukt", async () => {
      // APPROVED heeft 2 side-effects: Klaviyo + BullMQ
      mockTrackEvent.mockRejectedValueOnce(new Error("Klaviyo timeout"));
      mockEnqueueIssueLabelJob.mockResolvedValueOnce(undefined);

      await onStateTransition("retour_001", "SUBMITTED", "APPROVED", testContext);

      // BullMQ wordt nog steeds geprobeerd (onafhankelijk van Klaviyo-fout)
      // Maar in onze implementatie worden Klaviyo-fouten intern afgevangen
      // dus enqueueIssueLabelJob wordt nog steeds aangeroepen
      expect(mockEnqueueIssueLabelJob).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Event-eigenschappen
  // -------------------------------------------------------------------------

  describe("Event-eigenschappen", () => {
    it("stuurt return_id en order_name in event-properties", async () => {
      await onStateTransition(
        "retour_xyz",
        "DRAFT",
        "SUBMITTED",
        { ...testContext, orderName: "#2099" },
      );

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            return_id: "retour_xyz",
            order_name: "#2099",
          }),
        }),
      );
    });

    it("stuurt uniqueId als combinatie van returnId en eventName", async () => {
      await onStateTransition("retour_001", "DRAFT", "SUBMITTED", testContext);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          uniqueId: "retour_001:Return_Submitted",
        }),
      );
    });

    it("stuurt customerEmail en customerId door naar Klaviyo", async () => {
      await onStateTransition("retour_001", "DRAFT", "SUBMITTED", {
        ...testContext,
        customerEmail: "test@janice.com",
        customerId: "gid://shopify/Customer/42",
      });

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          customerEmail: "test@janice.com",
          customerId: "gid://shopify/Customer/42",
        }),
      );
    });

    it("laadt reason_codes uit DB als niet meegeleverd in context", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { reasonCode: "TOO_BIG" },
            { reasonCode: "COLOR_DIFFERENT" },
          ]),
        }),
      });

      const contextZonderReason = { ...testContext };
      delete contextZonderReason.reasonCodes;

      await onStateTransition("retour_001", "DRAFT", "SUBMITTED", contextZonderReason);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            reason_codes: ["TOO_BIG", "COLOR_DIFFERENT"],
          }),
        }),
      );
    });
  });
});

/**
 * Tests voor Klaviyo Events client — JANICE Returns & Exchanges app
 *
 * Dekt:
 *  - Verzoek-structuur conform Klaviyo API v3 spec (data.type='event', metric, profile)
 *  - Alle 9 event-namen
 *  - 4xx foutafhandeling
 *  - Vroeg terugkeren als KLAVIYO_PRIVATE_KEY ontbreekt
 *  - email + uniqueId aanwezig in aanvraag
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  trackEvent,
  KLAVIYO_EVENT_NAMEN,
  type KlaviyoEvent,
  type KlaviyoEventName,
} from "./events.server.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@sentry/node", () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
  captureException: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

function maakTestEvent(overschrijf: Partial<KlaviyoEvent> = {}): KlaviyoEvent {
  return {
    eventName: "Return_Started",
    customerEmail: "klant@janice.com",
    customerId: "gid://shopify/Customer/99999",
    properties: {
      return_id: "retour_test_001",
      order_name: "#1042",
      total_refund_amount: "89.95",
      currency: "EUR",
      resolution: "refund",
      state: "DRAFT",
      reason_codes: ["CHANGED_MIND"],
    },
    uniqueId: "retour_test_001:Return_Started",
    ...overschrijf,
  };
}

function mockKlaviyoSuccesAntwoord() {
  return new Response(null, { status: 202 });
}

function mockKlaviyoFoutAntwoord(status: number, body: object = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Klaviyo Events client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      KLAVIYO_PRIVATE_KEY: process.env.KLAVIYO_PRIVATE_KEY,
      KLAVIYO_PRIVATE_API_KEY: process.env.KLAVIYO_PRIVATE_API_KEY,
    };

    process.env.KLAVIYO_PRIVATE_KEY = "pk_test_klaviyo_sleutel_janice";
    delete process.env.KLAVIYO_PRIVATE_API_KEY;

    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    for (const [key, waarde] of Object.entries(originalEnv)) {
      if (waarde === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = waarde;
      }
    }
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Vroeg terugkeren zonder credentials
  // -------------------------------------------------------------------------

  describe("Ontbrekende credentials", () => {
    it("retourneert vroeg zonder fout als KLAVIYO_PRIVATE_KEY ontbreekt", async () => {
      delete process.env.KLAVIYO_PRIVATE_KEY;
      delete process.env.KLAVIYO_PRIVATE_API_KEY;

      await expect(trackEvent(maakTestEvent())).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("gebruikt KLAVIYO_PRIVATE_API_KEY als KLAVIYO_PRIVATE_KEY ontbreekt", async () => {
      delete process.env.KLAVIYO_PRIVATE_KEY;
      process.env.KLAVIYO_PRIVATE_API_KEY = "pk_fallback_sleutel";

      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(maakTestEvent());

      const aanroep = fetchMock.mock.calls[0];
      const headers = aanroep![1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Klaviyo-API-Key pk_fallback_sleutel");
    });
  });

  // -------------------------------------------------------------------------
  // Aanvraag-structuur conform Klaviyo API v3
  // -------------------------------------------------------------------------

  describe("Aanvraag-structuur (Klaviyo API v3)", () => {
    it("stuurt aanvraag naar het juiste eindpunt", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(maakTestEvent());

      const aanroepUrl = String(fetchMock.mock.calls[0]![0]);
      expect(aanroepUrl).toBe("https://a.klaviyo.com/api/events/");
    });

    it("stuurt POST-methode", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(maakTestEvent());

      const opties = fetchMock.mock.calls[0]![1] as RequestInit;
      expect(opties.method).toBe("POST");
    });

    it("stuurt correcte Authorization-header", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(maakTestEvent());

      const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Klaviyo-API-Key pk_test_klaviyo_sleutel_janice");
    });

    it("stuurt revisie-header '2024-10-15'", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(maakTestEvent());

      const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
      expect(headers["revision"]).toBe("2024-10-15");
    });

    it("body heeft data.type='event'", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(maakTestEvent());

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(body.data.type).toBe("event");
    });

    it("body heeft metric.data.type='metric'", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(maakTestEvent({ eventName: "Return_Submitted" }));

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(body.data.attributes.metric.data.type).toBe("metric");
      expect(body.data.attributes.metric.data.attributes.name).toBe("Return_Submitted");
    });

    it("body heeft profile.data.type='profile' met e-mailadres", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(maakTestEvent({ customerEmail: "test@voorbeeld.nl" }));

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(body.data.attributes.profile.data.type).toBe("profile");
      expect(body.data.attributes.profile.data.attributes.email).toBe("test@voorbeeld.nl");
    });

    it("body bevat unique_id voor idempotentie", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(maakTestEvent({ uniqueId: "uniek-id-voor-test" }));

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(body.data.attributes.unique_id).toBe("uniek-id-voor-test");
    });

    it("body bevat e-mailadres in profiel", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(maakTestEvent({ customerEmail: "klant@janice.com" }));

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(body.data.attributes.profile.data.attributes.email).toBe("klant@janice.com");
    });

    it("stuurt customerId als external_id als aanwezig", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(
        maakTestEvent({ customerId: "gid://shopify/Customer/12345" }),
      );

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(body.data.attributes.profile.data.attributes.external_id).toBe(
        "gid://shopify/Customer/12345",
      );
    });

    it("stuurt geen external_id als customerId ontbreekt", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      const eventZonderCustomerId = maakTestEvent();
      delete eventZonderCustomerId.customerId;
      await trackEvent(eventZonderCustomerId);

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(
        body.data.attributes.profile.data.attributes.external_id,
      ).toBeUndefined();
    });

    it("body bevat event-properties", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      const eigenschappen = {
        return_id: "test-123",
        order_name: "#2042",
        total_refund_amount: "149.95",
        currency: "EUR",
        resolution: "store_credit",
        state: "SUBMITTED",
        reason_codes: ["TOO_BIG", "COLOR_DIFFERENT"],
      };

      await trackEvent(maakTestEvent({ properties: eigenschappen }));

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(body.data.attributes.properties.return_id).toBe("test-123");
      expect(body.data.attributes.properties.reason_codes).toEqual([
        "TOO_BIG",
        "COLOR_DIFFERENT",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Alle 9 event-namen
  // -------------------------------------------------------------------------

  describe("Alle 9 lifecycle-events", () => {
    for (const eventNaam of KLAVIYO_EVENT_NAMEN) {
      it(`verstuurt event '${eventNaam}' correct`, async () => {
        fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

        await trackEvent(maakTestEvent({ eventName: eventNaam as KlaviyoEventName }));

        const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
        expect(body.data.attributes.metric.data.attributes.name).toBe(eventNaam);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Return_Label_Issued met tracking_number
  // -------------------------------------------------------------------------

  describe("Return_Label_Issued event", () => {
    it("kan tracking_number meesturen in properties", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(
        maakTestEvent({
          eventName: "Return_Label_Issued",
          properties: {
            return_id: "retour_001",
            order_name: "#1042",
            total_refund_amount: "89.95",
            currency: "EUR",
            resolution: "refund",
            state: "LABEL_ISSUED",
            reason_codes: ["DAMAGED"],
            tracking_number: "JVGL012345678NL",
          },
        }),
      );

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(body.data.attributes.properties.tracking_number).toBe("JVGL012345678NL");
    });
  });

  // -------------------------------------------------------------------------
  // 4xx foutafhandeling
  // -------------------------------------------------------------------------

  describe("4xx foutafhandeling", () => {
    it("gooit Error bij 401 Unauthorized", async () => {
      fetchMock.mockResolvedValueOnce(
        mockKlaviyoFoutAntwoord(401, { errors: [{ detail: "Ongeldige API-sleutel" }] }),
      );

      await expect(trackEvent(maakTestEvent())).rejects.toThrow(/401/);
    });

    it("gooit Error bij 400 Bad Request", async () => {
      fetchMock.mockResolvedValueOnce(
        mockKlaviyoFoutAntwoord(400, { errors: [{ detail: "Ongeldige body" }] }),
      );

      await expect(trackEvent(maakTestEvent())).rejects.toThrow(/400/);
    });

    it("gooit Error bij 422 Validation Error", async () => {
      fetchMock.mockResolvedValueOnce(
        mockKlaviyoFoutAntwoord(422, { errors: [{ detail: "Validatiefout" }] }),
      );

      await expect(trackEvent(maakTestEvent())).rejects.toThrow(/422/);
    });
  });

  // -------------------------------------------------------------------------
  // Return_Completed met final_refund_amount
  // -------------------------------------------------------------------------

  describe("Return_Completed event", () => {
    it("kan final_refund_amount meesturen", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(
        maakTestEvent({
          eventName: "Return_Completed",
          properties: {
            return_id: "retour_001",
            order_name: "#1042",
            total_refund_amount: "89.95",
            currency: "EUR",
            resolution: "store_credit",
            state: "COMPLETED",
            reason_codes: ["CHANGED_MIND"],
            final_refund_amount: "89.95",
          },
        }),
      );

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(body.data.attributes.metric.data.attributes.name).toBe(
        "Return_Completed",
      );
      expect(body.data.attributes.properties.final_refund_amount).toBe("89.95");
    });
  });

  // -------------------------------------------------------------------------
  // Waarde-berekening
  // -------------------------------------------------------------------------

  describe("Waarde-berekening", () => {
    it("zet total_refund_amount string om naar getal voor value-veld", async () => {
      fetchMock.mockResolvedValueOnce(mockKlaviyoSuccesAntwoord());

      await trackEvent(
        maakTestEvent({
          properties: {
            return_id: "retour_001",
            order_name: "#1042",
            total_refund_amount: "149.95",
            currency: "EUR",
            resolution: "refund",
            state: "SUBMITTED",
            reason_codes: [],
          },
        }),
      );

      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body ?? "{}"));
      expect(body.data.attributes.value).toBe(149.95);
    });
  });
});

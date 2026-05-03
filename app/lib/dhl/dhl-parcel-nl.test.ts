/**
 * Tests voor DHL Parcel NL Returns API client
 *
 * Dekt:
 *  - Token-caching (2 aanroepen delen 1 token-aanvraag)
 *  - Happy path: label aanmaken + trackingNumber + qrToken
 *  - 5xx herpoging (1 maal)
 *  - 4xx geen herpoging (DhlValidationError)
 *  - Token-verloop → nieuw token aanvragen
 *  - DhlNotConfiguredError bij ontbrekende env-vars
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createReturnLabel,
  haalDhlTokenOp,
  DhlNotConfiguredError,
  DhlValidationError,
  _resetTokenCacheVoorTests,
  type DhlReturnLabelInput,
  type Address,
} from "./parcel-nl.server.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Sentry-stub
vi.mock("@sentry/node", () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
  captureException: vi.fn(),
}));

// ioredis-stub — voorkomt echte Redis-verbindingen in tests
vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    quit: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Testdata
// ---------------------------------------------------------------------------

const testMagazijnadres: Address = {
  name: "JANICE Retourcentrum",
  addressLine1: "Magazijnstraat 1",
  postalCode: "1000 AA",
  city: "Amsterdam",
  countryCode: "NL",
};

const testKlantAdres: Address = {
  name: "Jan de Vries",
  addressLine1: "Prinsengracht 100",
  postalCode: "1015 AB",
  city: "Amsterdam",
  countryCode: "NL",
  email: "jan@voorbeeld.nl",
};

const testLabelInput: DhlReturnLabelInput = {
  returnId: "retour_test_001",
  receiverWarehouseAddress: testMagazijnadres,
  senderCustomerAddress: testKlantAdres,
  weight: 500,
  isQrPrintless: true,
};

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

function mockTokenAntwoord(accessToken = "test-token-abc123") {
  return new Response(
    JSON.stringify({ accessToken, expiresIn: 3600 }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function mockLabelAntwoord(trackingNumber = "JVGL012345678NL", qrCode = "QR_DATA_ABC") {
  return new Response(
    JSON.stringify({
      trackingNumber,
      qrCodeData: qrCode,
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function mockLabelAntwoordMetPDF(trackingNumber = "JVGL012345678NL") {
  return new Response(
    JSON.stringify({
      trackingNumber,
      labelUrl: "https://cdn.dhl.com/labels/test.pdf",
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Omgevingsvariabelen instellen
// ---------------------------------------------------------------------------

const envVarsVoorTests = {
  DHL_PARCEL_NL_API_URL: "https://api-test.dhlparcel.nl",
  DHL_PARCEL_NL_USER_ID: "test-user-id",
  DHL_PARCEL_NL_KEY: "test-api-key",
  DHL_PARCEL_NL_ACCOUNT_ID: "test-account-id",
  REDIS_URL: undefined, // Geen Redis in tests
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DHL Parcel NL client", () => {
  let originalEnv: Record<string, string | undefined>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Sla originele env op
    originalEnv = {};
    for (const key of Object.keys(envVarsVoorTests)) {
      originalEnv[key] = process.env[key];
    }

    // Stel test-env in
    for (const [key, waarde] of Object.entries(envVarsVoorTests)) {
      if (waarde === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = waarde;
      }
    }

    // Reset token-cache
    _resetTokenCacheVoorTests();

    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    // Herstel env-vars
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
  // DhlNotConfiguredError
  // -------------------------------------------------------------------------

  describe("DhlNotConfiguredError", () => {
    it("gooit DhlNotConfiguredError als DHL_PARCEL_NL_USER_ID ontbreekt", async () => {
      delete process.env.DHL_PARCEL_NL_USER_ID;

      await expect(createReturnLabel(testLabelInput)).rejects.toThrow(
        DhlNotConfiguredError,
      );
    });

    it("gooit DhlNotConfiguredError als DHL_PARCEL_NL_KEY ontbreekt", async () => {
      delete process.env.DHL_PARCEL_NL_KEY;

      await expect(createReturnLabel(testLabelInput)).rejects.toThrow(
        DhlNotConfiguredError,
      );
    });

    it("gooit DhlNotConfiguredError als DHL_PARCEL_NL_ACCOUNT_ID ontbreekt", async () => {
      delete process.env.DHL_PARCEL_NL_ACCOUNT_ID;

      await expect(createReturnLabel(testLabelInput)).rejects.toThrow(
        DhlNotConfiguredError,
      );
    });

    it("DhlNotConfiguredError vermeldt welke variabelen ontbreken", async () => {
      delete process.env.DHL_PARCEL_NL_USER_ID;
      delete process.env.DHL_PARCEL_NL_KEY;

      try {
        await createReturnLabel(testLabelInput);
        expect.fail("Zou fout moeten gooien");
      } catch (fout) {
        expect(fout).toBeInstanceOf(DhlNotConfiguredError);
        const err = fout as DhlNotConfiguredError;
        expect(err.message).toContain("DHL_PARCEL_NL_USER_ID");
        expect(err.message).toContain("DHL_PARCEL_NL_KEY");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Token-caching
  // -------------------------------------------------------------------------

  describe("Token-caching", () => {
    it("hergebruikt het gecachte token bij 2 opeenvolgende aanroepen (1 token-aanvraag)", async () => {
      // Eerste aanroep: token + label
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord("gedeeld-token"))
        .mockResolvedValueOnce(mockLabelAntwoord("TRACK001"));

      // Tweede aanroep: hergebruik token + label
      fetchMock
        .mockResolvedValueOnce(mockLabelAntwoord("TRACK002"));

      const resultaat1 = await createReturnLabel(testLabelInput);
      const resultaat2 = await createReturnLabel(testLabelInput);

      expect(resultaat1.trackingNumber).toBe("TRACK001");
      expect(resultaat2.trackingNumber).toBe("TRACK002");

      // Slechts 1 token-aanvraag (authenticate/api-key) in totaal 3 fetch-aanroepen
      const tokenAanroepen = fetchMock.mock.calls.filter((args) =>
        String(args[0]).includes("authenticate"),
      );
      expect(tokenAanroepen).toHaveLength(1);
    });

    it("vraagt een nieuw token aan als de cache verlopen is", async () => {
      // Stel vervallen token in via directe cache-manipulatie
      // Reset cache om verloop te simuleren
      _resetTokenCacheVoorTests();

      // Eerste aanvraag
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord("token-1"))
        .mockResolvedValueOnce(mockLabelAntwoord("TRACK001"));

      await createReturnLabel(testLabelInput);

      // Tweede aanvraag na cache-reset (simuleer verloop)
      _resetTokenCacheVoorTests();

      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord("token-2"))
        .mockResolvedValueOnce(mockLabelAntwoord("TRACK002"));

      await createReturnLabel(testLabelInput);

      const tokenAanroepen = fetchMock.mock.calls.filter((args) =>
        String(args[0]).includes("authenticate"),
      );
      expect(tokenAanroepen).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("Happy path", () => {
    it("retourneert trackingNumber en qrToken bij QR-printless aanvraag", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValueOnce(mockLabelAntwoord("JVGL012345678NL", "QR_TEST_DATA"));

      const resultaat = await createReturnLabel(testLabelInput);

      expect(resultaat.trackingNumber).toBe("JVGL012345678NL");
      expect(resultaat.qrToken).toBe("QR_TEST_DATA");
      expect(resultaat.labelUrl).toBeUndefined();
      expect(resultaat.expiresAt).toBeInstanceOf(Date);
    });

    it("retourneert trackingNumber en labelUrl bij PDF-label aanvraag", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValueOnce(mockLabelAntwoordMetPDF("JVGL999888777NL"));

      const resultaat = await createReturnLabel({
        ...testLabelInput,
        isQrPrintless: false,
      });

      expect(resultaat.trackingNumber).toBe("JVGL999888777NL");
      expect(resultaat.labelUrl).toBe("https://cdn.dhl.com/labels/test.pdf");
      expect(resultaat.qrToken).toBeUndefined();
    });

    it("stuurt het accountId correct mee in de aanvraag", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValueOnce(mockLabelAntwoord());

      await createReturnLabel(testLabelInput);

      const labelAanroep = fetchMock.mock.calls.find((args) =>
        String(args[0]).includes("/labels"),
      );
      expect(labelAanroep).toBeDefined();

      const body = JSON.parse(String(labelAanroep![1]?.body ?? "{}"));
      expect(body.accountId).toBe("test-account-id");
    });

    it("stuurt Authorization-header met Bearer-token mee", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord("mijn-token-xyz"))
        .mockResolvedValueOnce(mockLabelAntwoord());

      await createReturnLabel(testLabelInput);

      const labelAanroep = fetchMock.mock.calls.find((args) =>
        String(args[0]).includes("/labels"),
      );
      const headers = labelAanroep![1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer mijn-token-xyz");
    });

    it("berekent gewicht correct (grammen naar kg voor DHL)", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValueOnce(mockLabelAntwoord());

      await createReturnLabel({ ...testLabelInput, weight: 750 });

      const labelAanroep = fetchMock.mock.calls.find((args) =>
        String(args[0]).includes("/labels"),
      );
      const body = JSON.parse(String(labelAanroep![1]?.body ?? "{}"));
      expect(body.pieces[0].weight).toBe(0.75); // 750g → 0.75 kg
    });

    it("gebruikt standaard gewicht van 500g als niet opgegeven", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValueOnce(mockLabelAntwoord());

      const inputZonderGewicht = { ...testLabelInput };
      delete inputZonderGewicht.weight;
      await createReturnLabel(inputZonderGewicht);

      const labelAanroep = fetchMock.mock.calls.find((args) =>
        String(args[0]).includes("/labels"),
      );
      const body = JSON.parse(String(labelAanroep![1]?.body ?? "{}"));
      expect(body.pieces[0].weight).toBe(0.5); // 500g → 0.5 kg
    });

    it("stuurt vervaldatum 30 dagen vooruit als expiryDate ontbreekt in antwoord", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ trackingNumber: "TRACK001", qrCodeData: "QR" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );

      const resultaat = await createReturnLabel(testLabelInput);

      const dertigDagenVooruit = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      // Marge van 5 seconden voor test-timing
      expect(resultaat.expiresAt.getTime()).toBeGreaterThan(
        dertigDagenVooruit.getTime() - 5_000,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 5xx herpoging
  // -------------------------------------------------------------------------

  describe("5xx herpoging", () => {
    it("herprobeert één maal bij 503 Service Unavailable", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        // Eerste label-poging: 503
        .mockResolvedValueOnce(
          new Response("Service Unavailable", { status: 503 }),
        )
        // Tweede label-poging: succes
        .mockResolvedValueOnce(mockLabelAntwoord("TRACK_RETRY"));

      const resultaat = await createReturnLabel(testLabelInput);

      expect(resultaat.trackingNumber).toBe("TRACK_RETRY");

      const labelAanroepen = fetchMock.mock.calls.filter((args) =>
        String(args[0]).includes("/labels"),
      );
      expect(labelAanroepen).toHaveLength(2);
    }, 10_000);

    it("gooit fout na 2 mislukte 5xx-pogingen", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
        .mockResolvedValueOnce(new Response("Server Error", { status: 500 }));

      await expect(createReturnLabel(testLabelInput)).rejects.toThrow();
    }, 10_000);

    it("herprobeert niet meer dan maxPogingen keer", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValue(new Response("Server Error", { status: 500 }));

      await expect(createReturnLabel(testLabelInput)).rejects.toBeDefined();

      const labelAanroepen = fetchMock.mock.calls.filter((args) =>
        String(args[0]).includes("/labels"),
      );
      expect(labelAanroepen).toHaveLength(2); // Max 2 pogingen
    }, 10_000);
  });

  // -------------------------------------------------------------------------
  // 4xx geen herpoging
  // -------------------------------------------------------------------------

  describe("4xx geen herpoging", () => {
    it("gooit DhlValidationError bij 422 Unprocessable Entity", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: "Ongeldig adres" }),
            { status: 422, headers: { "Content-Type": "application/json" } },
          ),
        );

      await expect(createReturnLabel(testLabelInput)).rejects.toThrow(
        DhlValidationError,
      );

      // Slechts 1 label-poging (geen herpoging bij 4xx)
      const labelAanroepen = fetchMock.mock.calls.filter((args) =>
        String(args[0]).includes("/labels"),
      );
      expect(labelAanroepen).toHaveLength(1);
    });

    it("DhlValidationError bevat statusCode en responseBody", async () => {
      const foutBody = { error: "Klantadres ongeldig", code: "INVALID_ADDRESS" };

      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValueOnce(
          new Response(JSON.stringify(foutBody), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        );

      try {
        await createReturnLabel(testLabelInput);
        expect.fail("Zou fout moeten gooien");
      } catch (fout) {
        expect(fout).toBeInstanceOf(DhlValidationError);
        const err = fout as DhlValidationError;
        expect(err.statusCode).toBe(400);
        expect(err.responseBody).toEqual(foutBody);
      }
    });

    it("herprobeert niet bij 401 Unauthorized", async () => {
      fetchMock
        .mockResolvedValueOnce(mockTokenAntwoord())
        .mockResolvedValueOnce(
          new Response("Unauthorized", { status: 401 }),
        );

      await expect(createReturnLabel(testLabelInput)).rejects.toThrow(
        DhlValidationError,
      );

      const labelAanroepen = fetchMock.mock.calls.filter((args) =>
        String(args[0]).includes("/labels"),
      );
      expect(labelAanroepen).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // haalDhlTokenOp directe tests
  // -------------------------------------------------------------------------

  describe("haalDhlTokenOp()", () => {
    it("vraagt nieuw token aan bij lege cache", async () => {
      fetchMock.mockResolvedValueOnce(mockTokenAntwoord("vers-token"));

      const config = {
        apiUrl: "https://api-test.dhlparcel.nl",
        userId: "user-1",
        apiKey: "key-1",
        accountId: "acc-1",
      };

      const token = await haalDhlTokenOp(config);
      expect(token).toBe("vers-token");
    });

    it("hergebruikt in-memory cache bij herhaalde aanroep", async () => {
      fetchMock.mockResolvedValueOnce(mockTokenAntwoord("gecached-token"));

      const config = {
        apiUrl: "https://api-test.dhlparcel.nl",
        userId: "user-1",
        apiKey: "key-1",
        accountId: "acc-1",
      };

      const token1 = await haalDhlTokenOp(config);
      const token2 = await haalDhlTokenOp(config);

      expect(token1).toBe("gecached-token");
      expect(token2).toBe("gecached-token");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("gooit fout als token-antwoord accessToken mist", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ expiresIn: 3600 }), { status: 200 }),
      );

      const config = {
        apiUrl: "https://api-test.dhlparcel.nl",
        userId: "user-1",
        apiKey: "key-1",
        accountId: "acc-1",
      };

      await expect(haalDhlTokenOp(config)).rejects.toThrow(
        "DHL token-antwoord mist accessToken-veld",
      );
    });
  });
});

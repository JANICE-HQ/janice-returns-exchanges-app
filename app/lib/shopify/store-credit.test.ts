/**
 * Tests voor Shopify Store Credit client — JANICE Returns & Exchanges app
 *
 * Dekt:
 *  - Happy path: klant crediteren + wallet_transactions insert
 *  - userErrors afhandeling
 *  - Account-aanmaak pad (klant heeft nog geen Store Credit Account)
 *  - Nauwkeurige EUR-berekening via Decimal.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  creditCustomer,
  ShopifyStoreCreditFout,
  type CreditCustomerInput,
} from "./store-credit.server.js";

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted voorkomt hoisting-problemen)
// ---------------------------------------------------------------------------

const { mockShopifyAdmin, mockDbInsert, mockDb } = vi.hoisted(() => {
  const mockShopifyAdmin = vi.fn();
  const mockDbInsert = vi.fn().mockResolvedValue([{ id: "wallet_001" }]);
  const mockDb = {
    insert: vi.fn(() => ({
      values: mockDbInsert,
    })),
  };
  return { mockShopifyAdmin, mockDbInsert, mockDb };
});

vi.mock("@sentry/node", () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
  captureException: vi.fn(),
}));

vi.mock("~/lib/shopify.server", () => ({
  shopifyAdmin: (...args: unknown[]) => mockShopifyAdmin(...args),
}));

vi.mock("../../../db/index.js", () => ({
  db: mockDb,
}));

vi.mock("../../../db/schema.js", () => ({
  walletTransactions: {},
}));

// ---------------------------------------------------------------------------
// Testdata
// ---------------------------------------------------------------------------

const testInput: CreditCustomerInput = {
  customerId: "gid://shopify/Customer/99999",
  amount: 89.95,
  currency: "EUR",
  reason: "Retourvergoeding test",
  returnId: "retour_test_001",
};

// Mock-antwoorden voor GraphQL-aanroepen

function mockHaalAccountOpAntwoord(accountId = "gid://shopify/StoreCreditAccount/111") {
  return {
    customer: {
      id: "gid://shopify/Customer/99999",
      storeCreditAccounts: {
        edges: [
          {
            node: {
              id: accountId,
              balance: { amount: "0.00", currencyCode: "EUR" },
            },
          },
        ],
      },
    },
  };
}

function mockGeenBestaandAccountAntwoord() {
  return {
    customer: {
      id: "gid://shopify/Customer/99999",
      storeCreditAccounts: {
        edges: [],
      },
    },
  };
}

function mockAccountCreateAntwoord(accountId = "gid://shopify/StoreCreditAccount/222") {
  return {
    storeCreditAccountCreate: {
      storeCreditAccount: {
        id: accountId,
        balance: { amount: "0.00", currencyCode: "EUR" },
      },
      userErrors: [],
    },
  };
}

function mockCreditAntwoord(
  transactieId = "gid://shopify/StoreCreditAccountTransaction/333",
  balansNa = 89.95,
) {
  return {
    storeCreditAccountCredit: {
      storeCreditAccountTransaction: {
        id: transactieId,
        amount: { amount: "89.95", currencyCode: "EUR" },
        account: {
          balance: { amount: String(balansNa), currencyCode: "EUR" },
        },
      },
      userErrors: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Shopify Store Credit client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockDbInsert });
    mockDbInsert.mockResolvedValue([{ id: "wallet_001" }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path — bestaand account
  // -------------------------------------------------------------------------

  describe("Happy path — bestaand Store Credit Account", () => {
    it("retourneert shopifyTransactionId en balanceAfter bij succes", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockHaalAccountOpAntwoord()) // query: haal account op
        .mockResolvedValueOnce(mockCreditAntwoord("gid://shopify/StoreCreditAccountTransaction/333", 89.95));

      const resultaat = await creditCustomer(testInput);

      expect(resultaat.shopifyTransactionId).toBe(
        "gid://shopify/StoreCreditAccountTransaction/333",
      );
      expect(resultaat.balanceAfter).toBe(89.95);
    });

    it("roept shopifyAdmin aan met juiste mutatie en variabelen", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockHaalAccountOpAntwoord("gid://shopify/StoreCreditAccount/111"))
        .mockResolvedValueOnce(mockCreditAntwoord());

      await creditCustomer(testInput);

      // Tweede aanroep is de credit-mutatie
      const creditAanroep = mockShopifyAdmin.mock.calls[1];
      expect(creditAanroep![1]).toEqual({
        id: "gid://shopify/StoreCreditAccount/111",
        creditInput: {
          creditAmount: {
            amount: "89.95",
            currencyCode: "EUR",
          },
          reason: "Retourvergoeding test",
        },
      });
    });

    it("insert wallet_transactions-rij na succesvolle creditering", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockHaalAccountOpAntwoord())
        .mockResolvedValueOnce(mockCreditAntwoord("tx_123", 89.95));

      await creditCustomer(testInput);

      expect(mockDb.insert).toHaveBeenCalledOnce();
      const insertWaarden = mockDbInsert.mock.calls[0]?.[0];
      expect(insertWaarden).toBeDefined();
      expect(insertWaarden?.returnId).toBe("retour_test_001");
      expect(insertWaarden?.customerId).toBe("gid://shopify/Customer/99999");
      expect(insertWaarden?.amount).toBe("89.95");
      expect(insertWaarden?.currency).toBe("EUR");
      expect(insertWaarden?.shopifyStoreCreditAccountTransactionId).toBe("tx_123");
      expect(insertWaarden?.reason).toBe("Retourvergoeding test");
    });

    it("slaat balansna correct op in wallet_transactions", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockHaalAccountOpAntwoord())
        .mockResolvedValueOnce(mockCreditAntwoord("tx_123", 189.90));

      await creditCustomer(testInput);

      const insertWaarden = mockDbInsert.mock.calls[0]?.[0];
      // balanceAfter moet "189.90" zijn (als string met 2 decimalen)
      expect(parseFloat(insertWaarden?.balanceAfter ?? "0")).toBeCloseTo(189.90);
    });

    it("gebruikt Decimal.js voor nauwkeurige EUR-berekening", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockHaalAccountOpAntwoord())
        .mockResolvedValueOnce(mockCreditAntwoord("tx_123", 0.30));

      // Test floating-point geval: 0.1 + 0.2 = 0.3 (niet 0.30000000000000004)
      await creditCustomer({ ...testInput, amount: 0.1 + 0.2 });

      const creditAanroep = mockShopifyAdmin.mock.calls[1];
      // Decimal.js zou "0.30" geven ipv "0.30000000000000004"
      expect(creditAanroep![1]?.creditInput?.creditAmount?.amount).toBe("0.30");
    });
  });

  // -------------------------------------------------------------------------
  // Account-aanmaak pad (geen bestaand account)
  // -------------------------------------------------------------------------

  describe("Account-aanmaak pad", () => {
    it("maakt nieuw Store Credit Account aan als klant er geen heeft", async () => {
      const nieuweTransactieId = "gid://shopify/StoreCreditAccountTransaction/NIEUW_TX";
      mockShopifyAdmin
        .mockResolvedValueOnce(mockGeenBestaandAccountAntwoord()) // geen account
        .mockResolvedValueOnce(mockAccountCreateAntwoord("gid://shopify/StoreCreditAccount/NIEUW")) // account aanmaken
        .mockResolvedValueOnce(mockCreditAntwoord(nieuweTransactieId, 89.95)); // credit

      const resultaat = await creditCustomer(testInput);

      expect(resultaat.shopifyTransactionId).toBe(nieuweTransactieId);

      // 3 GraphQL-aanroepen: query + mutation create + mutation credit
      expect(mockShopifyAdmin).toHaveBeenCalledTimes(3);
    });

    it("gebruikt het nieuw aangemaakte account-ID voor de credit-mutatie", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockGeenBestaandAccountAntwoord())
        .mockResolvedValueOnce(mockAccountCreateAntwoord("gid://shopify/StoreCreditAccount/NIEUW_ID"))
        .mockResolvedValueOnce(mockCreditAntwoord());

      await creditCustomer(testInput);

      const creditAanroep = mockShopifyAdmin.mock.calls[2];
      expect(creditAanroep![1]?.id).toBe("gid://shopify/StoreCreditAccount/NIEUW_ID");
    });

    it("gooit ShopifyStoreCreditFout als account-aanmaak userErrors retourneert", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockGeenBestaandAccountAntwoord())
        .mockResolvedValueOnce({
          storeCreditAccountCreate: {
            storeCreditAccount: null,
            userErrors: [
              { field: ["customerId"], message: "Klant niet gevonden" },
            ],
          },
        });

      await expect(creditCustomer(testInput)).rejects.toThrow(
        ShopifyStoreCreditFout,
      );
    });
  });

  // -------------------------------------------------------------------------
  // userErrors afhandeling
  // -------------------------------------------------------------------------

  describe("userErrors afhandeling", () => {
    it("gooit ShopifyStoreCreditFout als credit-mutatie userErrors retourneert", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockHaalAccountOpAntwoord())
        .mockResolvedValueOnce({
          storeCreditAccountCredit: {
            storeCreditAccountTransaction: null,
            userErrors: [
              { field: ["creditInput", "creditAmount"], message: "Bedrag te groot" },
            ],
          },
        });

      await expect(creditCustomer(testInput)).rejects.toThrow(
        ShopifyStoreCreditFout,
      );
    });

    it("ShopifyStoreCreditFout bevat alle userErrors", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockHaalAccountOpAntwoord())
        .mockResolvedValueOnce({
          storeCreditAccountCredit: {
            storeCreditAccountTransaction: null,
            userErrors: [
              { field: ["id"], message: "Account niet gevonden" },
              { field: ["creditInput"], message: "Ongeldige invoer" },
            ],
          },
        });

      try {
        await creditCustomer(testInput);
        expect.fail("Zou fout moeten gooien");
      } catch (fout) {
        expect(fout).toBeInstanceOf(ShopifyStoreCreditFout);
        const err = fout as ShopifyStoreCreditFout;
        expect(err.userErrors).toHaveLength(2);
        expect(err.message).toContain("Account niet gevonden");
        expect(err.message).toContain("Ongeldige invoer");
      }
    });

    it("gooit Error als storeCreditAccountTransaction null is zonder userErrors", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockHaalAccountOpAntwoord())
        .mockResolvedValueOnce({
          storeCreditAccountCredit: {
            storeCreditAccountTransaction: null,
            userErrors: [],
          },
        });

      await expect(creditCustomer(testInput)).rejects.toThrow(
        "Shopify stuurde een leeg storeCreditAccountTransaction terug",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Bedrag-verwerking
  // -------------------------------------------------------------------------

  describe("Bedrag-verwerking", () => {
    it("stuurt amount als string met 2 decimalen", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockHaalAccountOpAntwoord())
        .mockResolvedValueOnce(mockCreditAntwoord());

      await creditCustomer({ ...testInput, amount: 149.0 });

      const creditAanroep = mockShopifyAdmin.mock.calls[1];
      expect(creditAanroep![1]?.creditInput?.creditAmount?.amount).toBe("149.00");
    });

    it("verwerkt kleine bedragen correct (2 decimalen)", async () => {
      mockShopifyAdmin
        .mockResolvedValueOnce(mockHaalAccountOpAntwoord())
        .mockResolvedValueOnce(mockCreditAntwoord());

      await creditCustomer({ ...testInput, amount: 5.99 });

      const creditAanroep = mockShopifyAdmin.mock.calls[1];
      expect(creditAanroep![1]?.creditInput?.creditAmount?.amount).toBe("5.99");
    });
  });
});

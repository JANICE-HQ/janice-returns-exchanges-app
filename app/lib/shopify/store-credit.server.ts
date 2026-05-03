/**
 * Shopify Store Credit (Wallet) client — JANICE Returns & Exchanges app
 *
 * Schrijft winkelkrediet bij via de Shopify Admin API (2025-01).
 * Gebruikt de storeCreditAccountCredit-mutatie.
 *
 * Na succesvolle creditering:
 *  - Insert een wallet_transactions-rij met Shopify-transactie-ID en balans.
 *
 * Alle bedragen in EUR. Decimal.js wordt gebruikt voor nauwkeurige rekenkunde.
 */

import * as Sentry from "@sentry/node";
import Decimal from "decimal.js";
import { db } from "../../../db/index.js";
import { walletTransactions } from "../../../db/schema.js";
import { shopifyAdmin } from "~/lib/shopify.server";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface CreditCustomerInput {
  /** Shopify GID van de klant: gid://shopify/Customer/... */
  customerId: string;
  /** Bedrag in EUR — wordt intern omgezet als nodig */
  amount: number;
  /** Valuta — V1 uitsluitend EUR */
  currency: "EUR";
  /** Reden voor het credit (voor audit-trail) */
  reason: string;
  /** Intern retour-ID voor correlatie */
  returnId: string;
}

export interface CreditCustomerResult {
  /** Shopify Store Credit Account Transaction GID */
  shopifyTransactionId: string;
  /** Balans na deze transactie in EUR */
  balanceAfter: number;
}

// ---------------------------------------------------------------------------
// Foutklasse
// ---------------------------------------------------------------------------

export class ShopifyStoreCreditFout extends Error {
  public readonly userErrors: Array<{ field: string[]; message: string }>;

  constructor(userErrors: Array<{ field: string[]; message: string }>) {
    const berichten = userErrors.map((e) => e.message).join("; ");
    super(`Shopify Store Credit-fout: ${berichten}`);
    this.name = "ShopifyStoreCreditFout";
    this.userErrors = userErrors;
  }
}

// ---------------------------------------------------------------------------
// GraphQL queries & mutaties
// ---------------------------------------------------------------------------

const HAAL_STORE_CREDIT_ACCOUNT_OP = `
  query HaalStoreCreditAccountOp($customerId: ID!) {
    customer(id: $customerId) {
      id
      storeCreditAccounts(first: 1) {
        edges {
          node {
            id
            balance {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

const STORE_CREDIT_ACCOUNT_CREATE = `
  mutation StoreCreditAccountCreate($customerId: ID!) {
    storeCreditAccountCreate(customerId: $customerId) {
      storeCreditAccount {
        id
        balance {
          amount
          currencyCode
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const STORE_CREDIT_ACCOUNT_CREDIT = `
  mutation StoreCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
    storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
      storeCreditAccountTransaction {
        id
        amount {
          amount
          currencyCode
        }
        account {
          balance {
            amount
            currencyCode
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Interne typen voor GraphQL-antwoorden
// ---------------------------------------------------------------------------

interface StoreCreditAccountNode {
  id: string;
  balance: {
    amount: string;
    currencyCode: string;
  };
}

interface HaalStoreCreditAccountOpAntwoord {
  customer: {
    id: string;
    storeCreditAccounts: {
      edges: Array<{ node: StoreCreditAccountNode }>;
    };
  } | null;
}

interface StoreCreditAccountCreateAntwoord {
  storeCreditAccountCreate: {
    storeCreditAccount: StoreCreditAccountNode | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

interface StoreCreditAccountCreditAntwoord {
  storeCreditAccountCredit: {
    storeCreditAccountTransaction: {
      id: string;
      amount: { amount: string; currencyCode: string };
      account: { balance: { amount: string; currencyCode: string } };
    } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

// ---------------------------------------------------------------------------
// Hoofd-functie: klant crediteren
// ---------------------------------------------------------------------------

/**
 * Schrijf winkelkrediet bij voor een klant.
 *
 * 1. Laad het Store Credit Account van de klant (of maak er een aan).
 * 2. Voer de creditering uit via storeCreditAccountCredit-mutatie.
 * 3. Insert een wallet_transactions-rij.
 *
 * @throws ShopifyStoreCreditFout — bij userErrors in het Shopify-antwoord
 * @throws Error                  — bij netwerk-/GraphQL-fouten
 */
export async function creditCustomer(
  input: CreditCustomerInput,
): Promise<CreditCustomerResult> {
  return Sentry.startSpan(
    {
      op: "http.client",
      name: "Shopify storeCreditAccountCredit",
      attributes: {
        "customer.id": input.customerId,
        "return.id": input.returnId,
        "credit.amount": String(input.amount),
        "credit.currency": input.currency,
      },
    },
    async () => {
      // Stap 1: Haal Store Credit Account op (of maak aan)
      const accountId = await haalOfMaakStoreCreditAccount(input.customerId);

      // Stap 2: Nauwkeurige EUR-bedrag via Decimal.js
      const bedragDecimal = new Decimal(input.amount);
      const bedragString = bedragDecimal.toFixed(2);

      // Log de actie (zonder gevoelige data)
      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "store_credit_credit_attempt",
          return_id: input.returnId,
          customer_id: input.customerId,
          amount: bedragString,
          currency: input.currency,
        }) + "\n",
      );

      // Stap 3: Crediteer de klant
      const creditAntwoord =
        await shopifyAdmin<StoreCreditAccountCreditAntwoord>(
          STORE_CREDIT_ACCOUNT_CREDIT,
          {
            id: accountId,
            creditInput: {
              creditAmount: {
                amount: bedragString,
                currencyCode: input.currency,
              },
              reason: input.reason.substring(0, 255),
            },
          },
        );

      const { storeCreditAccountTransaction, userErrors } =
        creditAntwoord.storeCreditAccountCredit;

      if (userErrors.length > 0) {
        throw new ShopifyStoreCreditFout(userErrors);
      }

      if (!storeCreditAccountTransaction) {
        throw new Error(
          "Shopify stuurde een leeg storeCreditAccountTransaction terug",
        );
      }

      const shopifyTransactieId = storeCreditAccountTransaction.id;
      const balansNa = parseFloat(
        storeCreditAccountTransaction.account.balance.amount,
      );

      // Stap 4: Insert wallet_transactions-rij
      await db.insert(walletTransactions).values({
        id: crypto.randomUUID(),
        returnId: input.returnId,
        customerId: input.customerId,
        amount: bedragString,
        currency: input.currency,
        shopifyStoreCreditAccountTransactionId: shopifyTransactieId,
        reason: input.reason,
        balanceAfter: String(balansNa.toFixed(2)),
        createdAt: new Date(),
      });

      // Log succes
      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "store_credit_credited",
          return_id: input.returnId,
          customer_id: input.customerId,
          shopify_transaction_id: shopifyTransactieId,
          amount: bedragString,
          balance_after: balansNa,
        }) + "\n",
      );

      return {
        shopifyTransactionId: shopifyTransactieId,
        balanceAfter: balansNa,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Intern: Store Credit Account ophalen of aanmaken
// ---------------------------------------------------------------------------

/**
 * Haal het Store Credit Account GID op voor een klant.
 * Als de klant nog geen account heeft, wordt er een aangemaakt.
 */
async function haalOfMaakStoreCreditAccount(
  customerId: string,
): Promise<string> {
  const queryAntwoord =
    await shopifyAdmin<HaalStoreCreditAccountOpAntwoord>(
      HAAL_STORE_CREDIT_ACCOUNT_OP,
      { customerId },
    );

  const bestaandeAccounts =
    queryAntwoord.customer?.storeCreditAccounts.edges ?? [];

  if (bestaandeAccounts.length > 0 && bestaandeAccounts[0]) {
    return bestaandeAccounts[0].node.id;
  }

  // Geen bestaand account — maak er een aan
  process.stdout.write(
    JSON.stringify({
      level: "INFO",
      ts: new Date().toISOString(),
      event: "store_credit_account_create",
      customer_id: customerId,
      message: "Klant heeft geen Store Credit Account — wordt aangemaakt",
    }) + "\n",
  );

  const createAntwoord =
    await shopifyAdmin<StoreCreditAccountCreateAntwoord>(
      STORE_CREDIT_ACCOUNT_CREATE,
      { customerId },
    );

  const { storeCreditAccount, userErrors } =
    createAntwoord.storeCreditAccountCreate;

  if (userErrors.length > 0) {
    throw new ShopifyStoreCreditFout(userErrors);
  }

  if (!storeCreditAccount) {
    throw new Error(
      "Shopify kon geen Store Credit Account aanmaken voor klant",
    );
  }

  return storeCreditAccount.id;
}

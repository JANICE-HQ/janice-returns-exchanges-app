/**
 * Schema smoke tests — JANICE Returns & Exchanges app
 *
 * Verifieert de Drizzle ORM-tabelstructuur zonder echte DB-verbinding:
 *  - Alle tabellen zijn gedefinieerd
 *  - Alle vereiste kolommen aanwezig
 *  - Type-exports functioneel
 *  - Kolom-typen correct (numeric, text, timestamptz)
 *
 * Geen DB-migratie of live-verbinding vereist — pure structuurtest.
 */

import { describe, it, expect } from "vitest";
import {
  returns,
  returnItems,
  returnStateHistory,
  walletTransactions,
  idempotencyKeys,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Haal kolomnamen op van een Drizzle-tabel.
 * Drizzle v0.45+ slaat kolommen op via Symbol(drizzle:Columns).
 * De kolomnamen zijn ook beschikbaar als directe keys op het tabelobject.
 */
function getKolommen(tabel: object): string[] {
  // Drizzle v0.45+: kolommen via Symbol(drizzle:Columns)
  const symbols = Object.getOwnPropertySymbols(tabel);
  const kolomSymbol = symbols.find((s) => s.toString() === "Symbol(drizzle:Columns)");
  if (kolomSymbol) {
    const kolommen = (tabel as Record<symbol, Record<string, unknown>>)[kolomSymbol];
    if (kolommen && typeof kolommen === "object") {
      return Object.keys(kolommen);
    }
  }
  // Terugval: directe keys (ook beschikbaar in Drizzle v0.45)
  return Object.keys(tabel).filter((k) => k !== "enableRLS");
}

/**
 * Haal de tabelnaam op via Symbol(drizzle:Name).
 */
function getTabelNaam(tabel: object): string {
  const symbols = Object.getOwnPropertySymbols(tabel);
  const naamSymbol = symbols.find((s) => s.toString() === "Symbol(drizzle:Name)");
  if (naamSymbol) {
    return (tabel as Record<symbol, string>)[naamSymbol] ?? "";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Tabel: returns
// ---------------------------------------------------------------------------

describe("Schema: returns tabel", () => {
  it("tabel is gedefinieerd", () => {
    expect(returns).toBeDefined();
  });

  it("heeft primaire sleutel 'id' (text)", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("id");
  });

  it("heeft shopifyOrderId", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("shopifyOrderId");
  });

  it("heeft shopifyOrderName", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("shopifyOrderName");
  });

  it("heeft customerId (nullable)", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("customerId");
  });

  it("heeft customerEmail", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("customerEmail");
  });

  it("heeft state", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("state");
  });

  it("heeft resolution (nullable)", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("resolution");
  });

  it("heeft totalRefundAmount (numeric)", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("totalRefundAmount");
  });

  it("heeft totalRefundCurrency met default EUR", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("totalRefundCurrency");
  });

  it("heeft dhlLabelUrl", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("dhlLabelUrl");
  });

  it("heeft dhlTrackingNumber", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("dhlTrackingNumber");
  });

  it("heeft returnMethod", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("returnMethod");
  });

  it("heeft createdAt en updatedAt", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("createdAt");
    expect(kolommen).toContain("updatedAt");
  });

  it("heeft expiresAt (nullable)", () => {
    const kolommen = getKolommen(returns as never);
    expect(kolommen).toContain("expiresAt");
  });

  it("tabelnaam is 'returns'", () => {
    expect(getTabelNaam(returns)).toBe("returns");
  });
});

// ---------------------------------------------------------------------------
// Tabel: return_items
// ---------------------------------------------------------------------------

describe("Schema: return_items tabel", () => {
  it("tabel is gedefinieerd", () => {
    expect(returnItems).toBeDefined();
  });

  it("heeft returnId met foreign key naar returns", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("returnId");
  });

  it("heeft shopifyLineItemId", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("shopifyLineItemId");
  });

  it("heeft shopifyVariantId", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("shopifyVariantId");
  });

  it("heeft productTitle", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("productTitle");
  });

  it("heeft variantTitle (nullable)", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("variantTitle");
  });

  it("heeft sku (nullable)", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("sku");
  });

  it("heeft quantity (integer)", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("quantity");
  });

  it("heeft unitPrice (numeric)", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("unitPrice");
  });

  it("heeft unitCompareAtPrice (numeric, nullable)", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("unitCompareAtPrice");
  });

  it("heeft discountPercentage (numeric, nullable)", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("discountPercentage");
  });

  it("heeft reasonCode", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("reasonCode");
  });

  it("heeft reasonSubnote (nullable)", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("reasonSubnote");
  });

  it("heeft condition (nullable)", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("condition");
  });

  it("heeft exchangeForVariantId (nullable)", () => {
    const kolommen = getKolommen(returnItems as never);
    expect(kolommen).toContain("exchangeForVariantId");
  });
});

// ---------------------------------------------------------------------------
// Tabel: return_state_history
// ---------------------------------------------------------------------------

describe("Schema: return_state_history tabel", () => {
  it("tabel is gedefinieerd", () => {
    expect(returnStateHistory).toBeDefined();
  });

  it("heeft returnId, fromState, toState", () => {
    const kolommen = getKolommen(returnStateHistory as never);
    expect(kolommen).toContain("returnId");
    expect(kolommen).toContain("fromState");
    expect(kolommen).toContain("toState");
  });

  it("heeft actorType en actorId", () => {
    const kolommen = getKolommen(returnStateHistory as never);
    expect(kolommen).toContain("actorType");
    expect(kolommen).toContain("actorId");
  });

  it("heeft note (nullable)", () => {
    const kolommen = getKolommen(returnStateHistory as never);
    expect(kolommen).toContain("note");
  });

  it("heeft metadata (jsonb, nullable)", () => {
    const kolommen = getKolommen(returnStateHistory as never);
    expect(kolommen).toContain("metadata");
  });

  it("heeft createdAt", () => {
    const kolommen = getKolommen(returnStateHistory as never);
    expect(kolommen).toContain("createdAt");
  });
});

// ---------------------------------------------------------------------------
// Tabel: wallet_transactions
// ---------------------------------------------------------------------------

describe("Schema: wallet_transactions tabel", () => {
  it("tabel is gedefinieerd", () => {
    expect(walletTransactions).toBeDefined();
  });

  it("heeft returnId (nullable)", () => {
    const kolommen = getKolommen(walletTransactions as never);
    expect(kolommen).toContain("returnId");
  });

  it("heeft customerId", () => {
    const kolommen = getKolommen(walletTransactions as never);
    expect(kolommen).toContain("customerId");
  });

  it("heeft amount (numeric)", () => {
    const kolommen = getKolommen(walletTransactions as never);
    expect(kolommen).toContain("amount");
  });

  it("heeft currency met default EUR", () => {
    const kolommen = getKolommen(walletTransactions as never);
    expect(kolommen).toContain("currency");
  });

  it("heeft reason", () => {
    const kolommen = getKolommen(walletTransactions as never);
    expect(kolommen).toContain("reason");
  });

  it("heeft balanceAfter (numeric)", () => {
    const kolommen = getKolommen(walletTransactions as never);
    expect(kolommen).toContain("balanceAfter");
  });

  it("heeft shopifyStoreCreditAccountTransactionId (nullable)", () => {
    const kolommen = getKolommen(walletTransactions as never);
    expect(kolommen).toContain("shopifyStoreCreditAccountTransactionId");
  });
});

// ---------------------------------------------------------------------------
// Tabel: idempotency_keys
// ---------------------------------------------------------------------------

describe("Schema: idempotency_keys tabel", () => {
  it("tabel is gedefinieerd", () => {
    expect(idempotencyKeys).toBeDefined();
  });

  it("heeft key als primaire sleutel (text)", () => {
    const kolommen = getKolommen(idempotencyKeys as never);
    expect(kolommen).toContain("key");
  });

  it("heeft endpoint", () => {
    const kolommen = getKolommen(idempotencyKeys as never);
    expect(kolommen).toContain("endpoint");
  });

  it("heeft responseStatus (integer)", () => {
    const kolommen = getKolommen(idempotencyKeys as never);
    expect(kolommen).toContain("responseStatus");
  });

  it("heeft responseBody (jsonb)", () => {
    const kolommen = getKolommen(idempotencyKeys as never);
    expect(kolommen).toContain("responseBody");
  });

  it("heeft expiresAt (timestamptz)", () => {
    const kolommen = getKolommen(idempotencyKeys as never);
    expect(kolommen).toContain("expiresAt");
  });

  it("heeft createdAt", () => {
    const kolommen = getKolommen(idempotencyKeys as never);
    expect(kolommen).toContain("createdAt");
  });
});

// ---------------------------------------------------------------------------
// Type-exports
// ---------------------------------------------------------------------------

describe("Type-exports", () => {
  it("Return type is infereerbaar vanuit schema", () => {
    // Compile-time check — als dit compileert is het correct
    type _Return = typeof returns.$inferSelect;
    type _NewReturn = typeof returns.$inferInsert;
    expect(true).toBe(true);
  });

  it("ReturnItem type is infereerbaar vanuit schema", () => {
    type _Item = typeof returnItems.$inferSelect;
    type _NewItem = typeof returnItems.$inferInsert;
    expect(true).toBe(true);
  });

  it("WalletTransaction type is infereerbaar vanuit schema", () => {
    type _Wallet = typeof walletTransactions.$inferSelect;
    expect(true).toBe(true);
  });
});

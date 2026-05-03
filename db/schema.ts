/**
 * Drizzle ORM schema — JANICE Returns & Exchanges app
 * Tabellen: returns, return_items, return_state_history, wallet_transactions, idempotency_keys
 * Gegenereerd conform SHOPIFY-BUILD-PLAN.md § "Database schema (essentials)"
 */

import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Tabel: returns
// Één rij per retourverzoek. Houdt de 11-staps state machine bij.
// ---------------------------------------------------------------------------
export const returns = pgTable(
  "returns",
  {
    id: uuid("id").primaryKey(),

    /** Mirrors Shopify Returns API ID — uniek per retour */
    shopifyReturnId: text("shopify_return_id").unique(),

    shopifyOrderId: text("shopify_order_id").notNull(),

    /** Nullable voor gastretour */
    shopifyCustomerId: text("shopify_customer_id"),

    /** Ingevuld bij gastretour */
    guestEmail: text("guest_email"),

    /**
     * 11-staps state machine:
     * return_requested → return_in_transit → return_received →
     * return_approved | return_partially_approved | return_rejected →
     * refund_initiated | wallet_credited | exchange_shipped →
     * return_completed
     * Annulering: → return_cancelled (elk niet-terminal stadium)
     */
    state: text("state").notNull(),

    /** 'refund' | 'wallet_credit' | 'exchange' */
    resolutionType: text("resolution_type"),

    reasonCode: text("reason_code").notNull(),

    /** 'qr_label' | 'pdf_label' | 'in_store' */
    returnMethod: text("return_method"),

    /** DHL trackingcode teruggegeven vanuit de DHL Returns API */
    dhlReturnTracking: text("dhl_return_tracking"),

    /** 'qr_printless' | 'pdf' */
    dhlLabelType: text("dhl_label_type"),

    /** Tijdstip van fysieke ontvangst bij GoedGepickt-magazijn */
    goedgepicktReceivedAt: timestamp("goedgepickt_received_at", {
      withTimezone: true,
    }),

    /** €3,95 standaard, 0 voor kwaliteits-/beschadigingskwesties */
    returnFeeCents: integer("return_fee_cents").default(395),

    totalRefundCents: integer("total_refund_cents"),
    totalWalletCreditCents: integer("total_wallet_credit_cents"),

    opsNotes: text("ops_notes"),
    rejectionReason: text("rejection_reason"),

    /** Array van foto-URL's (Shopify Files) — optioneel voor kwaliteitsissues */
    photoUrls: text("photo_urls").array(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("returns_state_idx").on(table.state),
    index("returns_customer_idx").on(table.shopifyCustomerId),
    index("returns_order_idx").on(table.shopifyOrderId),
  ],
);

// ---------------------------------------------------------------------------
// Tabel: return_items
// Één rij per retourproduct (line-item niveau).
// ---------------------------------------------------------------------------
export const returnItems = pgTable("return_items", {
  id: uuid("id").primaryKey(),

  returnId: uuid("return_id")
    .references(() => returns.id, { onDelete: "cascade" })
    .notNull(),

  shopifyLineItemId: text("shopify_line_item_id").notNull(),
  variantId: text("variant_id").notNull(),
  quantity: integer("quantity").notNull(),

  unitPriceCents: integer("unit_price_cents").notNull(),

  /** Nodig voor de 60%-korting-berekening */
  compareAtPriceCents: integer("compare_at_price_cents"),

  /** Berekend: (compare_at - unit_price) / compare_at — maximaal 2 decimalen */
  discountPercentage: numeric("discount_percentage", { precision: 5, scale: 2 }),

  /** Nullable — ingevuld bij ruiling */
  exchangeVariantId: text("exchange_variant_id"),

  /** 'refund' | 'wallet_credit' | 'exchange' */
  resolution: text("resolution"),

  /** Nullable tot ops-beslissing */
  approved: boolean("approved"),

  rejectionReason: text("rejection_reason"),
});

// ---------------------------------------------------------------------------
// Tabel: return_state_history
// Append-only auditlog van alle state-overgangen.
// ---------------------------------------------------------------------------
export const returnStateHistory = pgTable("return_state_history", {
  id: uuid("id").primaryKey(),

  returnId: uuid("return_id")
    .references(() => returns.id, { onDelete: "cascade" })
    .notNull(),

  fromState: text("from_state"),
  toState: text("to_state").notNull(),

  /** 'customer' | 'system' | 'ops' | 'webhook' */
  actorType: text("actor_type").notNull(),

  /** Klant-ID, medewerker-ID, of naam van webhook-bron */
  actorId: text("actor_id"),

  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// Tabel: wallet_transactions
// Append-only creditledger — nooit verwijderen of bijwerken.
// Positief = tegoed, negatief = afschrijving.
// ---------------------------------------------------------------------------
export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: uuid("id").primaryKey(),

    shopifyCustomerId: text("shopify_customer_id").notNull(),

    /** Positief = tegoed, negatief = afschrijving (in eurocenten) */
    amountCents: integer("amount_cents").notNull(),

    /**
     * 'return_credit' | 'purchase_debit' | 'manual_credit' | 'pos_debit'
     */
    reason: text("reason").notNull(),

    /** return_id of order_id als referentie */
    referenceId: text("reference_id"),

    /** Shopify Store Credit Transaction ID indien gespiegeld naar Shopify native */
    shopifyStoreCreditTransactionId: text(
      "shopify_store_credit_transaction_id",
    ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("wallet_customer_idx").on(table.shopifyCustomerId),
  ],
);

// ---------------------------------------------------------------------------
// Tabel: idempotency_keys
// Voorkomt dubbele verwerking van Shopify-webhooks, GoedGepickt-webhooks, etc.
// ---------------------------------------------------------------------------
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),

  /** Bijv. 'shopify_webhook', 'goedgepickt_webhook' */
  scope: text("scope").notNull(),

  /** Hash van het verwerkte resultaat voor debugdoeleinden */
  resultHash: text("result_hash"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// Type-exports voor gebruik in loaders, actions en service-laag
// ---------------------------------------------------------------------------
export type Return = typeof returns.$inferSelect;
export type NewReturn = typeof returns.$inferInsert;

export type ReturnItem = typeof returnItems.$inferSelect;
export type NewReturnItem = typeof returnItems.$inferInsert;

export type ReturnStateHistory = typeof returnStateHistory.$inferSelect;
export type NewReturnStateHistory = typeof returnStateHistory.$inferInsert;

export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type NewWalletTransaction = typeof walletTransactions.$inferInsert;

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;

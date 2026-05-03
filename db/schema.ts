/**
 * Drizzle ORM schema — JANICE Returns & Exchanges app
 *
 * PR #2 herschrijft dit schema conform de volledige PRD-specificatie:
 *  - returns:               text PK (cuid2/ulid), shopify_order_name,
 *                           customer_email, resolution, DHL-label velden,
 *                           expires_at, total_refund_amount als numeric(10,2)
 *  - return_items:          product_title, variant_title, sku, unit_price
 *                           als numeric(10,2), reason_code, condition,
 *                           exchange_for_variant_id
 *  - return_state_history:  metadata (jsonb)
 *  - wallet_transactions:   amount als numeric(10,2), balance_after, return_id
 *  - idempotency_keys:      endpoint, response_status, response_body (jsonb),
 *                           expires_at
 *
 * Alle geldbedragen worden opgeslagen als numeric(10,2) in EUR.
 * Alle tijdstempels worden opgeslagen als timestamptz.
 * Primaire sleutels zijn text (cuid2/ulid) — geen uuid's.
 */

import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Tabel: returns
// Één rij per retourverzoek. Houdt de 11-staps state machine bij.
// ---------------------------------------------------------------------------
export const returns = pgTable(
  "returns",
  {
    /** cuid2 of ulid als primaire sleutel (text, niet uuid) */
    id: text("id").primaryKey(),

    /** Shopify GID: "gid://shopify/Order/12345" */
    shopifyOrderId: text("shopify_order_id").notNull(),

    /** Mensleesbaar bestelnummer: bijv. "#1042" */
    shopifyOrderName: text("shopify_order_name").notNull(),

    /** Nullable voor gastretour (enkel e-mail beschikbaar) */
    customerId: text("customer_id"),

    /** E-mailadres van de klant — altijd aanwezig */
    customerEmail: text("customer_email").notNull(),

    /**
     * 11-staps state machine (zie app/services/return-state-machine.ts):
     * DRAFT | SUBMITTED | APPROVED | REJECTED | LABEL_ISSUED |
     * IN_TRANSIT | RECEIVED | INSPECTING | COMPLETED | CANCELLED | EXPIRED
     */
    state: text("state").notNull(),

    /**
     * Gekozen afhandeling: 'refund' | 'exchange' | 'store_credit'
     * Null totdat klant of ops een keuze maakt.
     */
    resolution: text("resolution"),

    /** Totaal terug te betalen bedrag in EUR als numeric — geen floating point */
    totalRefundAmount: numeric("total_refund_amount", {
      precision: 10,
      scale: 2,
    }),

    /** Valuta — V1 ondersteunt uitsluitend EUR */
    totalRefundCurrency: text("total_refund_currency").default("EUR"),

    /** DHL retourlabel PDF- of QR-URL */
    dhlLabelUrl: text("dhl_label_url"),

    /** DHL trackingcode voor klantcommunicatie */
    dhlTrackingNumber: text("dhl_tracking_number"),

    /** 'dhl_qr' | 'dhl_label' | 'in_store' */
    returnMethod: text("return_method"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    /** Vervaldatum van het DHL-retourlabel */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("returns_order_id_idx").on(table.shopifyOrderId),
    index("returns_customer_id_idx").on(table.customerId),
    index("returns_state_idx").on(table.state),
  ],
);

// ---------------------------------------------------------------------------
// Tabel: return_items
// Één rij per retourproduct (line-item niveau).
// ---------------------------------------------------------------------------
export const returnItems = pgTable(
  "return_items",
  {
    /** cuid2 of ulid als primaire sleutel */
    id: text("id").primaryKey(),

    returnId: text("return_id")
      .notNull()
      .references(() => returns.id, { onDelete: "cascade" }),

    /** Shopify GID: "gid://shopify/LineItem/..." */
    shopifyLineItemId: text("shopify_line_item_id").notNull(),

    /** Shopify GID van de variant */
    shopifyVariantId: text("shopify_variant_id").notNull(),

    /** Productnaam zoals weergegeven aan de klant */
    productTitle: text("product_title").notNull(),

    /** Variantnaam, bijv. "Camel / M" */
    variantTitle: text("variant_title"),

    /** Artikelcode (SKU) */
    sku: text("sku"),

    /** Aantal retourartikelen — minimaal 1 (afgedwongen via CHECK-constraint) */
    quantity: integer("quantity").notNull(),

    /** Werkelijk betaalde prijs per stuk (na kortingen), in EUR */
    unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),

    /** Oorspronkelijke adviesprijs — null als er geen korting gold */
    unitCompareAtPrice: numeric("unit_compare_at_price", {
      precision: 10,
      scale: 2,
    }),

    /**
     * Berekende korting in procenten:
     * (compare_at_price - unit_price) / compare_at_price * 100
     * Null als compare_at_price ontbreekt.
     */
    discountPercentage: numeric("discount_percentage", {
      precision: 5,
      scale: 2,
    }),

    /**
     * Retourredencode (zie app/services/reason-codes.ts):
     * TOO_BIG | TOO_SMALL | COLOR_DIFFERENT | DAMAGED | LATE_DELIVERY |
     * WRONG_ITEM | NOT_AS_DESCRIBED | CHANGED_MIND
     */
    reasonCode: text("reason_code").notNull(),

    /** Vrije toelichting van de klant bij de redencode */
    reasonSubnote: text("reason_subnote"),

    /** 'as_new' | 'worn' | 'damaged' — null totdat ops-beoordeling plaatsvindt */
    condition: text("condition"),

    /** Shopify variant GID voor ruilartikel — alleen bij resolution=exchange */
    exchangeForVariantId: text("exchange_for_variant_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("return_items_quantity_positive", sql`${table.quantity} > 0`),
    index("return_items_return_id_idx").on(table.returnId),
    index("return_items_line_item_id_idx").on(table.shopifyLineItemId),
  ],
);

// ---------------------------------------------------------------------------
// Tabel: return_state_history
// Append-only auditlog van alle state-overgangen.
// ---------------------------------------------------------------------------
export const returnStateHistory = pgTable(
  "return_state_history",
  {
    id: text("id").primaryKey(),

    returnId: text("return_id")
      .notNull()
      .references(() => returns.id, { onDelete: "cascade" }),

    /** Null bij de allereerste transitie (initiëren van de state) */
    fromState: text("from_state"),

    toState: text("to_state").notNull(),

    /** 'customer' | 'system' | 'ops_user' */
    actorType: text("actor_type").notNull(),

    /** Shopify customer_id of medewerker-ID */
    actorId: text("actor_id"),

    /** Optionele toelichting bij de transitie */
    note: text("note"),

    /**
     * Vrije JSON-payload — bijv. carrier-event payload van DHL-webhook.
     * Handig voor debugging en een volledige audit-trail.
     */
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("state_history_return_created_idx").on(
      table.returnId,
      table.createdAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Tabel: wallet_transactions
// Append-only creditledger — nooit verwijderen of bijwerken.
// Positief = tegoed bijgeschreven, negatief = tegoed besteed.
// ---------------------------------------------------------------------------
export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: text("id").primaryKey(),

    /** Nullable — niet elke transactie is direct gekoppeld aan een retour */
    returnId: text("return_id"),

    customerId: text("customer_id").notNull(),

    /**
     * Positief = tegoed bijgeschreven, negatief = besteed.
     * Opgeslagen als numeric(10,2) in EUR — géén eurocenten.
     */
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),

    /** Valuta — V1 uitsluitend EUR */
    currency: text("currency").notNull().default("EUR"),

    /** Gespiegelde Shopify Store Credit Account Transaction ID */
    shopifyStoreCreditAccountTransactionId: text(
      "shopify_store_credit_account_transaction_id",
    ),

    /** 'return_refund' | 'compensation' | 'promo' | 'spent' */
    reason: text("reason").notNull(),

    /**
     * Balansmomentopname na deze transactie — voor auditing.
     * Nooit wijzigen na insert.
     */
    balanceAfter: numeric("balance_after", {
      precision: 10,
      scale: 2,
    }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("wallet_customer_id_idx").on(table.customerId),
    index("wallet_return_id_idx").on(table.returnId),
  ],
);

// ---------------------------------------------------------------------------
// Tabel: idempotency_keys
// Voorkomt dubbele verwerking van identieke verzoeken binnen 24 uur.
// ---------------------------------------------------------------------------
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    /** Client-supplied UUID als primaire sleutel */
    key: text("key").primaryKey(),

    /** Bijv. 'POST /apps/returns/submit' */
    endpoint: text("endpoint").notNull(),

    /** HTTP-statuscode van het gecachte antwoord */
    responseStatus: integer("response_status").notNull(),

    /** Volledig gecachet antwoord als JSON-object */
    responseBody: jsonb("response_body").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    /** 24 uur na aanmaak — voor opruiming via cron-job */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idempotency_expires_at_idx").on(table.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Type-exports — gebruik in loaders, actions en service-laag
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

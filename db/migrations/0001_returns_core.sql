-- JANICE Returns & Exchanges app — Migratie 0001
-- PR #2: Herschrijf schema naar PR #2-specificatie
--
-- WAARSCHUWING: Deze migratie verwijdert de bestaande tabellen uit PR #1
-- en maakt ze opnieuw aan met de correcte structuur.
-- Voer ALLEEN uit op een lege of fresh database — geen productiedata aanwezig.
--
-- Gebruik:
--   npx drizzle-kit migrate   (via Coolify deploy-pipeline)
--
-- Rollback:
--   Zie 0001_returns_core_rollback.sql (handmatig aan te maken als needed)

--> statement-breakpoint

-- Verwijder bestaande tabellen in omgekeerde volgorde (foreign key afhankelijkheden)
DROP TABLE IF EXISTS "idempotency_keys" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "wallet_transactions" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "return_state_history" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "return_items" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "returns" CASCADE;
--> statement-breakpoint

-- ============================================================
-- Tabel: returns
-- ============================================================
CREATE TABLE "returns" (
  "id"                    text PRIMARY KEY NOT NULL,
  "shopify_order_id"      text NOT NULL,
  "shopify_order_name"    text NOT NULL,
  "customer_id"           text,
  "customer_email"        text NOT NULL,
  "state"                 text NOT NULL,
  "resolution"            text,
  "total_refund_amount"   numeric(10, 2),
  "total_refund_currency" text DEFAULT 'EUR',
  "dhl_label_url"         text,
  "dhl_tracking_number"   text,
  "return_method"         text,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  "expires_at"            timestamptz
);
--> statement-breakpoint

CREATE INDEX "returns_order_id_idx"    ON "returns" USING btree ("shopify_order_id");
--> statement-breakpoint
CREATE INDEX "returns_customer_id_idx" ON "returns" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX "returns_state_idx"       ON "returns" USING btree ("state");
--> statement-breakpoint

-- ============================================================
-- Tabel: return_items
-- ============================================================
CREATE TABLE "return_items" (
  "id"                       text PRIMARY KEY NOT NULL,
  "return_id"                text NOT NULL REFERENCES "returns"("id") ON DELETE CASCADE,
  "shopify_line_item_id"     text NOT NULL,
  "shopify_variant_id"       text NOT NULL,
  "product_title"            text NOT NULL,
  "variant_title"            text,
  "sku"                      text,
  "quantity"                 integer NOT NULL,
  "unit_price"               numeric(10, 2) NOT NULL,
  "unit_compare_at_price"    numeric(10, 2),
  "discount_percentage"      numeric(5, 2),
  "reason_code"              text NOT NULL,
  "reason_subnote"           text,
  "condition"                text,
  "exchange_for_variant_id"  text,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "return_items_quantity_positive" CHECK ("quantity" > 0)
);
--> statement-breakpoint

CREATE INDEX "return_items_return_id_idx"    ON "return_items" USING btree ("return_id");
--> statement-breakpoint
CREATE INDEX "return_items_line_item_id_idx" ON "return_items" USING btree ("shopify_line_item_id");
--> statement-breakpoint

-- ============================================================
-- Tabel: return_state_history
-- ============================================================
CREATE TABLE "return_state_history" (
  "id"          text PRIMARY KEY NOT NULL,
  "return_id"   text NOT NULL REFERENCES "returns"("id") ON DELETE CASCADE,
  "from_state"  text,
  "to_state"    text NOT NULL,
  "actor_type"  text NOT NULL,
  "actor_id"    text,
  "note"        text,
  "metadata"    jsonb,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX "state_history_return_created_idx"
  ON "return_state_history" USING btree ("return_id", "created_at");
--> statement-breakpoint

-- ============================================================
-- Tabel: wallet_transactions
-- ============================================================
CREATE TABLE "wallet_transactions" (
  "id"                                          text PRIMARY KEY NOT NULL,
  "return_id"                                   text,
  "customer_id"                                 text NOT NULL,
  "amount"                                      numeric(10, 2) NOT NULL,
  "currency"                                    text NOT NULL DEFAULT 'EUR',
  "shopify_store_credit_account_transaction_id" text,
  "reason"                                      text NOT NULL,
  "balance_after"                               numeric(10, 2) NOT NULL,
  "created_at"                                  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX "wallet_customer_id_idx" ON "wallet_transactions" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX "wallet_return_id_idx"   ON "wallet_transactions" USING btree ("return_id");
--> statement-breakpoint

-- ============================================================
-- Tabel: idempotency_keys
-- ============================================================
CREATE TABLE "idempotency_keys" (
  "key"             text PRIMARY KEY NOT NULL,
  "endpoint"        text NOT NULL,
  "response_status" integer NOT NULL,
  "response_body"   jsonb NOT NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "expires_at"      timestamptz NOT NULL
);
--> statement-breakpoint

CREATE INDEX "idempotency_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");

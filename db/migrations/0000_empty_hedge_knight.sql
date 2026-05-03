CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"result_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"return_id" uuid NOT NULL,
	"shopify_line_item_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"compare_at_price_cents" integer,
	"discount_percentage" numeric(5, 2),
	"exchange_variant_id" text,
	"resolution" text,
	"approved" boolean,
	"rejection_reason" text
);
--> statement-breakpoint
CREATE TABLE "return_state_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"return_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shopify_return_id" text,
	"shopify_order_id" text NOT NULL,
	"shopify_customer_id" text,
	"guest_email" text,
	"state" text NOT NULL,
	"resolution_type" text,
	"reason_code" text NOT NULL,
	"return_method" text,
	"dhl_return_tracking" text,
	"dhl_label_type" text,
	"goedgepickt_received_at" timestamp with time zone,
	"return_fee_cents" integer DEFAULT 395,
	"total_refund_cents" integer,
	"total_wallet_credit_cents" integer,
	"ops_notes" text,
	"rejection_reason" text,
	"photo_urls" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_shopify_return_id_unique" UNIQUE("shopify_return_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shopify_customer_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"reference_id" text,
	"shopify_store_credit_transaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_state_history" ADD CONSTRAINT "return_state_history_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "returns_state_idx" ON "returns" USING btree ("state");--> statement-breakpoint
CREATE INDEX "returns_customer_idx" ON "returns" USING btree ("shopify_customer_id");--> statement-breakpoint
CREATE INDEX "returns_order_idx" ON "returns" USING btree ("shopify_order_id");--> statement-breakpoint
CREATE INDEX "wallet_customer_idx" ON "wallet_transactions" USING btree ("shopify_customer_id");
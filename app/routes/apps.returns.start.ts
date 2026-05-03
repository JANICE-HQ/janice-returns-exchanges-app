/**
 * POST /apps/returns/start — Ingelogde klant start een retour
 *
 * Maakt een DRAFT-retour aan voor een ingelogde Shopify-klant.
 * Vereist geldige App Proxy HMAC-handtekening en ingelogde klant.
 *
 * Gedrag:
 *  1. Verifieer HMAC-handtekening
 *  2. Controleer of klant ingelogd is (loggedInCustomerId)
 *  3. Idempotentiecontrole
 *  4. Haal bestelling op via Shopify Admin GraphQL
 *  5. Controleer of bestelling van klant is
 *  6. Controleer retourgeschiktheid
 *  7. Maak DRAFT-retour aan met items
 *  8. Geef 201 terug
 */

import type { ActionFunctionArgs } from "react-router";
import * as Sentry from "@sentry/node";
import { db } from "../../db/index.js";
import { returns, returnItems, returnStateHistory } from "../../db/schema.js";
import {
  verifieerEnExtraheerProxyContext,
  maakOngeautoriseerdAntwoord,
  maakFoutAntwoord,
} from "~/lib/app-proxy-hmac.server";
import { withIdempotency, IdempotencyMismatchFout } from "~/lib/idempotency.server";
import { parseValideer, StartReturnSchema } from "~/lib/request-schemas";
import { haalBestellingOpId } from "~/lib/shopify-queries.server";
import type { ShopifyLineItemUitgebreid, ShopifyOrderUitgebreid } from "~/lib/shopify-queries.server";
import { checkEligibility } from "~/services/eligibility";
import { computeLineRefund } from "~/services/refund-calculator";
import { logVerzoek, logFout, startTimer, stopTimer } from "~/lib/structured-logger.server";
import Decimal from "decimal.js";

const ENDPOINT = "POST /apps/returns/start";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: { code: "method_not_allowed", message: "Alleen POST is toegestaan" } }, { status: 405 });
  }

  const start = startTimer();

  return Sentry.startSpan(
    { op: "http.server", name: ENDPOINT },
    async () => {
      // Stap 1: Verifieer HMAC
      let proxyContext;
      try {
        proxyContext = await verifieerEnExtraheerProxyContext(request);
      } catch {
        logVerzoek({ method: "POST", path: "/apps/returns/start", status: 401, duration_ms: stopTimer(start), actorId: "unknown" });
        return maakOngeautoriseerdAntwoord("App Proxy HMAC-verificatie mislukt");
      }

      // Stap 2: Klant moet ingelogd zijn
      if (!proxyContext.loggedInCustomerId) {
        logVerzoek({ method: "POST", path: "/apps/returns/start", status: 401, duration_ms: stopTimer(start), actorId: "guest" });
        return maakFoutAntwoord(401, "guest_must_use_lookup", "Gasten moeten /apps/returns/guest-lookup gebruiken");
      }

      const customerId = proxyContext.loggedInCustomerId;

      // Stap 3: Parseer en valideer aanvraagtekst
      let aanvraagTekst: unknown;
      try {
        aanvraagTekst = await request.json();
      } catch {
        return maakFoutAntwoord(400, "validation_failed", "Ongeldige JSON in aanvraagtekst");
      }

      const validatieResultaat = parseValideer(StartReturnSchema, aanvraagTekst);
      if (!validatieResultaat.succes) {
        return maakFoutAntwoord(400, "validation_failed", "Aanvraagvalidatie mislukt", {
          fouten: validatieResultaat.fouten,
        });
      }

      const invoer = validatieResultaat.data;

      // Stap 4: Idempotentiecontrole + uitvoering
      try {
        const resultaat = await withIdempotency<Record<string, unknown>>(
          invoer.idempotencyKey,
          ENDPOINT,
          24,
          async (): Promise<{ status: number; body: Record<string, unknown> }> => {
            // Stap 5: Haal bestelling op
            const bestelling = await haalBestellingOpId(invoer.shopifyOrderId);
            if (!bestelling) {
              return {
                status: 404,
                body: { error: { code: "not_found", message: "Bestelling niet gevonden" } },
              };
            }

            // Stap 6: Bestelling moet van klant zijn
            if (bestelling.customerId !== customerId) {
              return {
                status: 403,
                body: { error: { code: "order_not_yours", message: "Deze bestelling behoort niet aan u" } },
              };
            }

            // Stap 7: Retourgeschiktheidscontrole
            const lineItemIds = invoer.lineItems.map((l) => l.shopifyLineItemId);
            const gevraagdeHoeveelheden: Record<string, number> = {};
            for (const item of invoer.lineItems) {
              gevraagdeHoeveelheden[item.shopifyLineItemId] = item.quantity;
            }

            const geschiktheid = await checkEligibility({
              shopifyOrder: bestelling,
              lineItemIds,
              requestedQuantities: gevraagdeHoeveelheden,
            });

            if (!geschiktheid.eligible) {
              return {
                status: 422,
                body: {
                  eligible: false,
                  reasons: geschiktheid.reasons,
                },
              };
            }

            // Stap 8: Maak DRAFT-retour aan
            const nu = new Date();
            const retourId = crypto.randomUUID();

            // Bereken refund-bedragen per item
            const itemsMetRefund = invoer.lineItems.map((item) => {
              const shopifyItem = (bestelling as ShopifyOrderUitgebreid).lineItems.find(
                (l) => l.id === item.shopifyLineItemId,
              ) as ShopifyLineItemUitgebreid | undefined;
              if (!shopifyItem) {
                throw new Error(`Line item ${item.shopifyLineItemId} niet gevonden in bestelling`);
              }

              const refundResultaat = computeLineRefund({
                shopifyLineItemId: item.shopifyLineItemId,
                productTitle: shopifyItem.productTitle,
                unitPrice: shopifyItem.discountedUnitPrice,
                unitCompareAtPrice: shopifyItem.compareAtPrice ?? null,
                returnQuantity: item.quantity,
                isFinalSale: false,
              });

              return {
                item,
                shopifyItem,
                refundResultaat,
              };
            });

            // Totale terugbetaling
            const totaalRefund = itemsMetRefund
              .reduce(
                (som, { refundResultaat }) =>
                  som.plus(new Decimal(refundResultaat.refundAmount)),
                new Decimal(0),
              )
              .toFixed(2);

            // Vervaldatum retourvenster
            const vensterVervalDatum = geschiktheid.windowExpiresAt ?? new Date(nu.getTime() + 30 * 24 * 60 * 60 * 1000);

            await db.transaction(async (tx) => {
              // Insert returns-rij
              await tx.insert(returns).values({
                id: retourId,
                shopifyOrderId: invoer.shopifyOrderId,
                shopifyOrderName: bestelling.name,
                customerId,
                customerEmail: bestelling.customerEmail,
                state: "DRAFT",
                totalRefundAmount: totaalRefund,
                totalRefundCurrency: "EUR",
                expiresAt: vensterVervalDatum,
                createdAt: nu,
                updatedAt: nu,
              });

              // Insert return_items-rijen
              for (const { item, shopifyItem, refundResultaat } of itemsMetRefund) {
                await tx.insert(returnItems).values({
                  id: crypto.randomUUID(),
                  returnId: retourId,
                  shopifyLineItemId: item.shopifyLineItemId,
                  shopifyVariantId: shopifyItem.variantId,
                  productTitle: shopifyItem.productTitle,
                  variantTitle: shopifyItem.variantTitle ?? null,
                  sku: shopifyItem.sku ?? null,
                  quantity: item.quantity,
                  unitPrice: shopifyItem.discountedUnitPrice,
                  unitCompareAtPrice: shopifyItem.compareAtPrice ?? null,
                  discountPercentage: refundResultaat.discountPercentage,
                  reasonCode: item.reasonCode,
                  reasonSubnote: item.reasonSubnote ?? null,
                  createdAt: nu,
                });
              }

              // Insert initiële state-history rij
              await tx.insert(returnStateHistory).values({
                id: crypto.randomUUID(),
                returnId: retourId,
                fromState: null,
                toState: "DRAFT",
                actorType: "customer",
                actorId: customerId,
                note: "Retour aangemaakt door klant",
                metadata: null,
                createdAt: nu,
              });
            });

            return {
              status: 201,
              body: {
                id: retourId,
                state: "DRAFT",
                totalRefundAmount: totaalRefund,
                totalRefundCurrency: "EUR",
                items: itemsMetRefund.map(({ item, refundResultaat }) => ({
                  shopifyLineItemId: item.shopifyLineItemId,
                  quantity: item.quantity,
                  reasonCode: item.reasonCode,
                  refundAmount: refundResultaat.refundAmount,
                  discountPercentage: refundResultaat.discountPercentage,
                })),
                windowExpiresAt: vensterVervalDatum.toISOString(),
              },
            };
          },
        );

        logVerzoek({
          method: "POST",
          path: "/apps/returns/start",
          status: resultaat.status,
          duration_ms: stopTimer(start),
          actorId: customerId,
          returnId: resultaat.status === 201 && typeof resultaat.body === "object" && resultaat.body !== null && "id" in resultaat.body
            ? String((resultaat.body as { id: string }).id)
            : undefined,
          cached: resultaat.cached,
        });

        return Response.json(resultaat.body, { status: resultaat.status });
      } catch (fout) {
        if (fout instanceof IdempotencyMismatchFout) {
          return maakFoutAntwoord(409, "idempotency_key_reused_for_different_endpoint",
            "Deze idempotency-sleutel is al gebruikt voor een ander eindpunt");
        }

        logFout(fout, { method: "POST", path: "/apps/returns/start", actorId: customerId, duration_ms: stopTimer(start) });
        Sentry.captureException(fout);
        return maakFoutAntwoord(500, "internal_error", "Interne serverfout");
      }
    },
  );
}

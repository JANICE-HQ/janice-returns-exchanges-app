/**
 * POST /apps/returns/submit — Klant dient een retour in (DRAFT → SUBMITTED)
 *
 * Bevestigt een retourverzoek voor zowel ingelogde klanten (via returnId)
 * als gasten (via guestToken van /guest-lookup).
 *
 * Gedrag:
 *  1. Verifieer HMAC
 *  2. Idempotentiecontrole
 *  3. Valideer invoer
 *  4. Resolve retour (returnId of guestToken)
 *  5. Valideer resolutie vs. reden-routing
 *  6. Update retour + bereken totaal-terugbetaling
 *  7. Transitie state DRAFT → SUBMITTED
 *  8. Klaviyo-event stub (TODO PR #44)
 *  9. Geef 200 terug
 */

import type { ActionFunctionArgs } from "react-router";
import * as Sentry from "@sentry/node";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { returns, returnItems } from "../../db/schema.js";
import {
  verifieerEnExtraheerProxyContext,
  maakOngeautoriseerdAntwoord,
  maakFoutAntwoord,
} from "~/lib/app-proxy-hmac.server";
import { withIdempotency, IdempotencyMismatchFout } from "~/lib/idempotency.server";
import { parseValideer, SubmitReturnSchema } from "~/lib/request-schemas";
import { verifieerGastToken, GastTokenFout } from "~/lib/guest-jwt.server";
import { haalBestellingOpId } from "~/lib/shopify-queries.server";
import { checkEligibility } from "~/services/eligibility";
import { computeLineRefund } from "~/services/refund-calculator";
import { getAutoRouting } from "~/services/reason-codes";
import type { ReasonCode } from "~/services/reason-codes";
import { transition, InvalidTransitionError } from "~/services/return-state-machine";
import { logVerzoek, logFout, startTimer, stopTimer } from "~/lib/structured-logger.server";
import Decimal from "decimal.js";

const ENDPOINT = "POST /apps/returns/submit";

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
        logVerzoek({ method: "POST", path: "/apps/returns/submit", status: 401, duration_ms: stopTimer(start), actorId: "unknown" });
        return maakOngeautoriseerdAntwoord("App Proxy HMAC-verificatie mislukt");
      }

      // Stap 2: Parseer en valideer aanvraagtekst
      let aanvraagTekst: unknown;
      try {
        aanvraagTekst = await request.json();
      } catch {
        return maakFoutAntwoord(400, "validation_failed", "Ongeldige JSON in aanvraagtekst");
      }

      const validatieResultaat = parseValideer(SubmitReturnSchema, aanvraagTekst);
      if (!validatieResultaat.succes) {
        return maakFoutAntwoord(400, "validation_failed", "Aanvraagvalidatie mislukt", {
          fouten: validatieResultaat.fouten,
        });
      }

      const invoer = validatieResultaat.data;
      const actorId = proxyContext.loggedInCustomerId ?? "guest";

      // Stap 3: Idempotentiecontrole + uitvoering
      try {
        const resultaat = await withIdempotency<Record<string, unknown>>(
          invoer.idempotencyKey,
          ENDPOINT,
          24,
          async (): Promise<{ status: number; body: Record<string, unknown> }> => {
            let retourId: string;
            let customerId: string | null = proxyContext.loggedInCustomerId;
            let customerEmail: string = "";

            // Stap 4a: Ingelogde klant — laad bestaand DRAFT-retour
            if (invoer.returnId) {
              if (!proxyContext.loggedInCustomerId) {
                return {
                  status: 401,
                  body: { error: { code: "guest_must_use_lookup", message: "Gasten moeten guestToken gebruiken" } },
                };
              }

              const [bestaandRetour] = await db
                .select()
                .from(returns)
                .where(eq(returns.id, invoer.returnId))
                .limit(1);

              if (!bestaandRetour) {
                return { status: 404, body: { error: { code: "not_found", message: "Retour niet gevonden" } } };
              }

              if (bestaandRetour.customerId !== proxyContext.loggedInCustomerId) {
                return { status: 403, body: { error: { code: "order_not_yours", message: "Dit retourverzoek behoort niet aan u" } } };
              }

              if (bestaandRetour.state !== "DRAFT") {
                return {
                  status: 409,
                  body: {
                    error: {
                      code: "invalid_state",
                      message: `Retour kan niet worden ingediend vanuit state '${bestaandRetour.state}'. Vereiste state: DRAFT`,
                    },
                  },
                };
              }

              retourId = invoer.returnId;
              customerEmail = bestaandRetour.customerEmail;

            } else {
              // Stap 4b: Gast — verifieer JWT en maak DRAFT-retour on-the-fly aan
              if (!invoer.guestToken) {
                return { status: 400, body: { error: { code: "validation_failed", message: "guestToken is verplicht voor gasten" } } };
              }

              let gastPayload;
              try {
                gastPayload = await verifieerGastToken(invoer.guestToken);
              } catch (err) {
                if (err instanceof GastTokenFout) {
                  return { status: 401, body: { error: { code: "signature_invalid", message: err.message } } };
                }
                throw err;
              }

              customerEmail = gastPayload.customerEmail;
              customerId = null;

              // Haal bestelling op om DRAFT aan te maken
              const bestelling = await haalBestellingOpId(gastPayload.orderId);
              if (!bestelling) {
                return { status: 404, body: { error: { code: "not_found", message: "Bestelling niet gevonden" } } };
              }

              // Controleer geschiktheid
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
                  body: { eligible: false, reasons: geschiktheid.reasons },
                };
              }

              retourId = crypto.randomUUID();
              const nu = new Date();
              const vensterVervalDatum = geschiktheid.windowExpiresAt ?? new Date(nu.getTime() + 30 * 24 * 60 * 60 * 1000);

              // Bereken refund per item
              const itemsMetRefund = invoer.lineItems.map((item) => {
                const shopifyItem = bestelling.lineItems.find((l) => l.id === item.shopifyLineItemId);
                if (!shopifyItem) throw new Error(`Line item ${item.shopifyLineItemId} niet gevonden`);
                const refund = computeLineRefund({
                  shopifyLineItemId: item.shopifyLineItemId,
                  productTitle: shopifyItem.productTitle,
                  unitPrice: shopifyItem.discountedUnitPrice,
                  unitCompareAtPrice: shopifyItem.compareAtPrice ?? null,
                  returnQuantity: item.quantity,
                  isFinalSale: false,
                });
                return { item, shopifyItem, refund };
              });

              const totaalRefund = itemsMetRefund
                .reduce((som, { refund }) => som.plus(new Decimal(refund.refundAmount)), new Decimal(0))
                .toFixed(2);

              await db.transaction(async (tx) => {
                await tx.insert(returns).values({
                  id: retourId,
                  shopifyOrderId: gastPayload.orderId,
                  shopifyOrderName: bestelling.name,
                  customerId: null,
                  customerEmail,
                  state: "DRAFT",
                  totalRefundAmount: totaalRefund,
                  totalRefundCurrency: "EUR",
                  expiresAt: vensterVervalDatum,
                  createdAt: nu,
                  updatedAt: nu,
                });

                for (const { item, shopifyItem, refund } of itemsMetRefund) {
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
                    discountPercentage: refund.discountPercentage,
                    reasonCode: item.reasonCode,
                    reasonSubnote: item.reasonSubnote ?? null,
                    exchangeForVariantId: invoer.resolution === "exchange" ? (invoer.exchangeForVariantId ?? null) : null,
                    createdAt: nu,
                  });
                }
              });
            }

            // Stap 5: Valideer resolutie vs. reden-routing
            // Controleer elke redencode of de klant de resolutie mag overschrijven
            for (const item of invoer.lineItems) {
              const routing = getAutoRouting(item.reasonCode as ReasonCode);

              if (!routing.customerCanOverride && invoer.resolution !== routing.defaultResolution) {
                return {
                  status: 422,
                  body: {
                    error: {
                      code: "resolution_not_allowed_for_reason",
                      message: `Resolutie '${invoer.resolution}' is niet toegestaan voor redencode '${item.reasonCode}'. Verplichte resolutie: '${routing.defaultResolution}'`,
                      details: {
                        reasonCode: item.reasonCode,
                        allowedResolution: routing.defaultResolution,
                        requestedResolution: invoer.resolution,
                      },
                    },
                  },
                };
              }
            }

            // Bepaal of ops-review vereist is
            const vereistOpsReview = invoer.lineItems.some((item) =>
              getAutoRouting(item.reasonCode as ReasonCode).requiresOpsReview,
            );

            // Stap 6: Bereken totale terugbetaling voor update
            // (Voor ingelogde klanten waren items al aangemaakt in /start)
            const huidigeItems = await db
              .select()
              .from(returnItems)
              .where(eq(returnItems.returnId, retourId));

            let totaalRefundBedrag: string;

            if (huidigeItems.length > 0) {
              totaalRefundBedrag = huidigeItems
                .reduce((som, item) => {
                  const refund = computeLineRefund({
                    shopifyLineItemId: item.shopifyLineItemId,
                    productTitle: item.productTitle,
                    unitPrice: item.unitPrice,
                    unitCompareAtPrice: item.unitCompareAtPrice ?? null,
                    returnQuantity: item.quantity,
                    isFinalSale: false,
                  });
                  return som.plus(new Decimal(refund.refundAmount));
                }, new Decimal(0))
                .toFixed(2);
            } else {
              totaalRefundBedrag = "0.00";
            }

            // Update resolutie en exchange variant IDs op items
            const nu = new Date();
            await db
              .update(returns)
              .set({
                resolution: invoer.resolution,
                totalRefundAmount: totaalRefundBedrag,
                updatedAt: nu,
              })
              .where(eq(returns.id, retourId));

            if (invoer.resolution === "exchange" && invoer.exchangeForVariantId) {
              await db
                .update(returnItems)
                .set({ exchangeForVariantId: invoer.exchangeForVariantId })
                .where(eq(returnItems.returnId, retourId));
            }

            // Stap 7: State-transitie DRAFT → SUBMITTED
            const actor = customerId
              ? { type: "customer" as const, id: customerId }
              : { type: "customer" as const, id: customerEmail };

            await transition(
              retourId,
              "SUBMITTED",
              actor,
              vereistOpsReview ? "Retour ingediend — ops-review vereist" : "Retour ingediend door klant",
              vereistOpsReview ? { requiresOpsReview: true } : undefined,
            );

            // Stap 8: Klaviyo-event stub
            // TODO (PR #44 — Track A): Klaviyo event 'return_submitted' triggeren
            console.log("[STUB] Klaviyo event:", JSON.stringify({
              event: "return_submitted",
              payload: {
                returnId: retourId,
                customerEmail,
                resolution: invoer.resolution,
                totalRefundAmount: totaalRefundBedrag,
                requiresOpsReview: vereistOpsReview,
                lineItemCount: invoer.lineItems.length,
              },
            }));

            return {
              status: 200,
              body: {
                id: retourId,
                state: "SUBMITTED",
                resolution: invoer.resolution,
                totalRefundAmount: totaalRefundBedrag,
                totalRefundCurrency: "EUR",
                requiresOpsReview: vereistOpsReview,
              },
            };
          },
        );

        logVerzoek({
          method: "POST",
          path: "/apps/returns/submit",
          status: resultaat.status,
          duration_ms: stopTimer(start),
          actorId,
          returnId: resultaat.status === 200 && typeof resultaat.body === "object" && resultaat.body !== null && "id" in resultaat.body
            ? String((resultaat.body as unknown as { id: string }).id)
            : undefined,
          cached: resultaat.cached,
        });

        return Response.json(resultaat.body, { status: resultaat.status });
      } catch (fout) {
        if (fout instanceof IdempotencyMismatchFout) {
          return maakFoutAntwoord(409, "idempotency_key_reused_for_different_endpoint",
            "Deze idempotency-sleutel is al gebruikt voor een ander eindpunt");
        }

        if (fout instanceof InvalidTransitionError) {
          return maakFoutAntwoord(409, "invalid_state", fout.message);
        }

        logFout(fout, { method: "POST", path: "/apps/returns/submit", actorId, duration_ms: stopTimer(start) });
        Sentry.captureException(fout);
        return maakFoutAntwoord(500, "internal_error", "Interne serverfout");
      }
    },
  );
}

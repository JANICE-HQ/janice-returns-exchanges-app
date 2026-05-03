/**
 * GET /apps/returns/:id/status — Ophalen van retorstatus
 *
 * Publiek lees-eindpunt voor de huidige status van een retour.
 * Toegankelijk voor:
 *  - Ingelogde klanten: verificatie via loggedInCustomerId
 *  - Gasten: verificatie via ?token=<JWT> uit /guest-lookup
 *
 * Reactie bevat:
 *  - Huidige state, resolutie, terugbetalingsbedrag
 *  - DHL-label URL en trackingnummer (null tot LABEL_ISSUED)
 *  - Laatste 10 state-history-gebeurtenissen
 *  - Retour-items
 */

import type { LoaderFunctionArgs } from "react-router";
import * as Sentry from "@sentry/node";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { returns, returnItems, returnStateHistory } from "../../db/schema.js";
import {
  verifieerEnExtraheerProxyContext,
  maakOngeautoriseerdAntwoord,
  maakFoutAntwoord,
} from "~/lib/app-proxy-hmac.server";
import { verifieerGastToken, GastTokenFout } from "~/lib/guest-jwt.server";
import { logVerzoek, logFout, startTimer, stopTimer } from "~/lib/structured-logger.server";

const ENDPOINT = "GET /apps/returns/:id/status";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const start = startTimer();
  const retourId = params["id"];

  if (!retourId) {
    return maakFoutAntwoord(400, "validation_failed", "Retour-ID is verplicht");
  }

  return Sentry.startSpan(
    { op: "http.server", name: ENDPOINT },
    async () => {
      // Stap 1: Verifieer HMAC
      let proxyContext;
      try {
        proxyContext = await verifieerEnExtraheerProxyContext(request);
      } catch {
        logVerzoek({ method: "GET", path: `/apps/returns/${retourId}/status`, status: 401, duration_ms: stopTimer(start), actorId: "unknown" });
        return maakOngeautoriseerdAntwoord("App Proxy HMAC-verificatie mislukt");
      }

      // Stap 2: Laad het retourverzoek
      const [retour] = await db
        .select()
        .from(returns)
        .where(eq(returns.id, retourId))
        .limit(1);

      if (!retour) {
        logVerzoek({ method: "GET", path: `/apps/returns/${retourId}/status`, status: 404, duration_ms: stopTimer(start), actorId: proxyContext.loggedInCustomerId ?? "guest" });
        return maakFoutAntwoord(404, "not_found", "Retour niet gevonden");
      }

      // Stap 3: Autorisatiecontrole
      const url = new URL(request.url);
      const gastToken = url.searchParams.get("token");

      if (proxyContext.loggedInCustomerId) {
        // Ingelogde klant: verifieer eigenaarschap
        if (retour.customerId && retour.customerId !== proxyContext.loggedInCustomerId) {
          logVerzoek({ method: "GET", path: `/apps/returns/${retourId}/status`, status: 403, duration_ms: stopTimer(start), actorId: proxyContext.loggedInCustomerId });
          return maakFoutAntwoord(403, "order_not_yours", "Dit retourverzoek behoort niet aan u");
        }
      } else if (gastToken) {
        // Gast: verifieer JWT en controleer of het retour overeenkomt
        try {
          const gastPayload = await verifieerGastToken(gastToken);
          // Controleer of het e-mailadres overeenkomt met de retour
          if (gastPayload.customerEmail.toLowerCase() !== retour.customerEmail.toLowerCase()) {
            return maakFoutAntwoord(403, "order_not_yours", "Dit retourverzoek behoort niet aan u");
          }
        } catch (err) {
          if (err instanceof GastTokenFout) {
            return maakFoutAntwoord(401, "signature_invalid", err.message);
          }
          throw err;
        }
      } else {
        // Geen authenticatie — vereist login of gast-token
        return maakFoutAntwoord(401, "signature_invalid", "Authenticatie vereist: log in of gebruik een gast-token");
      }

      try {
        // Stap 4: Haal items en history op parallel
        const [items, history] = await Promise.all([
          db
            .select()
            .from(returnItems)
            .where(eq(returnItems.returnId, retourId))
            .limit(100), // Maximaal 100 items per retour (veiligheidsgrens)
          db
            .select()
            .from(returnStateHistory)
            .where(eq(returnStateHistory.returnId, retourId))
            .orderBy(desc(returnStateHistory.createdAt))
            .limit(10),
        ]);

        const actorId = proxyContext.loggedInCustomerId ?? "guest";
        logVerzoek({
          method: "GET",
          path: `/apps/returns/${retourId}/status`,
          status: 200,
          duration_ms: stopTimer(start),
          actorId,
          returnId: retourId,
        });

        return Response.json({
          id: retour.id,
          state: retour.state,
          resolution: retour.resolution ?? null,
          totalRefundAmount: retour.totalRefundAmount ?? null,
          totalRefundCurrency: retour.totalRefundCurrency ?? "EUR",
          items: items.map((item) => ({
            id: item.id,
            shopifyLineItemId: item.shopifyLineItemId,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle ?? null,
            sku: item.sku ?? null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountPercentage: item.discountPercentage ?? null,
            reasonCode: item.reasonCode,
            reasonSubnote: item.reasonSubnote ?? null,
            condition: item.condition ?? null,
            exchangeForVariantId: item.exchangeForVariantId ?? null,
          })),
          history: history.map((h) => ({
            fromState: h.fromState ?? null,
            toState: h.toState,
            actorType: h.actorType,
            createdAt: h.createdAt.toISOString(),
            note: h.note ?? null,
          })),
          // DHL-velden zijn null totdat LABEL_ISSUED-state bereikt wordt
          dhlLabelUrl: retour.dhlLabelUrl ?? null,
          dhlTrackingNumber: retour.dhlTrackingNumber ?? null,
          expiresAt: retour.expiresAt?.toISOString() ?? null,
        }, { status: 200 });
      } catch (fout) {
        logFout(fout, { method: "GET", path: `/apps/returns/${retourId}/status`, actorId: proxyContext.loggedInCustomerId ?? "guest", duration_ms: stopTimer(start) });
        Sentry.captureException(fout);
        return maakFoutAntwoord(500, "internal_error", "Interne serverfout");
      }
    },
  );
}

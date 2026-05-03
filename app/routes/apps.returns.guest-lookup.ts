/**
 * POST /apps/returns/guest-lookup — Gast zoekt een bestelling op
 *
 * Staat gasten toe om een bestaande retour te bekijken of een nieuwe te starten
 * zonder een Shopify-klantaccount. Rate-gelimiteerd op 5 pogingen per 15 minuten.
 *
 * Veiligheidsmaatregelen:
 *  - Rate limiting: 5 pogingen per IP per 15 minuten
 *  - Constante tijdvertraging: voorkomt timing-aanvallen op bestelling-bestaan
 *  - "Not found" lekt geen informatie over of een bestelling bestaat
 *  - JWT voor verdere acties: 15 minuten geldig
 */

import type { ActionFunctionArgs } from "react-router";
import * as Sentry from "@sentry/node";
import {
  verifieerEnExtraheerProxyContext,
  maakOngeautoriseerdAntwoord,
  maakFoutAntwoord,
} from "~/lib/app-proxy-hmac.server";
import { withIdempotency, IdempotencyMismatchFout } from "~/lib/idempotency.server";
import { parseValideer, GuestLookupSchema } from "~/lib/request-schemas";
import { genereerGastToken } from "~/lib/guest-jwt.server";
import { controleerRateLimit, extracteerClientIp } from "~/lib/rate-limiter.server";
import { haalBestellingOpNaamEnEmail } from "~/lib/shopify-queries.server";
import { checkEligibility } from "~/services/eligibility";
import { logVerzoek, logFout, startTimer, stopTimer } from "~/lib/structured-logger.server";

const ENDPOINT = "POST /apps/returns/guest-lookup";

/** Minimale reactietijd in ms voor constante-tijdreacties (timing-aanvalsbescherming) */
const MIN_REACTIETIJD_MS = 200;

/**
 * Wacht tot een minimale tijd verstreken is om timing-aanvallen te voorkomen.
 * Als de verwerking al langer duurde, wacht er niet extra.
 */
async function constanteTijdVertraging(startMs: number): Promise<void> {
  const verstreken = Date.now() - startMs;
  const resterende = MIN_REACTIETIJD_MS - verstreken;
  if (resterende > 0) {
    await new Promise((resolve) => setTimeout(resolve, resterende));
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: { code: "method_not_allowed", message: "Alleen POST is toegestaan" } }, { status: 405 });
  }

  const start = startTimer();

  return Sentry.startSpan(
    { op: "http.server", name: ENDPOINT },
    async () => {
      // Stap 1: Verifieer HMAC
      try {
        await verifieerEnExtraheerProxyContext(request);
      } catch {
        await constanteTijdVertraging(start);
        logVerzoek({ method: "POST", path: "/apps/returns/guest-lookup", status: 401, duration_ms: stopTimer(start), actorId: "unknown" });
        return maakOngeautoriseerdAntwoord("App Proxy HMAC-verificatie mislukt");
      }

      // Stap 2: Rate limiting op IP-adres
      const clientIp = extracteerClientIp(request);
      let rateLimitResultaat;
      try {
        rateLimitResultaat = await controleerRateLimit({
          identifier: clientIp,
          endpoint: "guest-lookup",
          maxPogingen: 5,
          vensterSeconds: 15 * 60, // 15 minuten
        });
      } catch (rateLimitFout) {
        // Redis-fout — log en val door (fail-open voor gebruikerservaring)
        logFout(rateLimitFout, { method: "POST", path: "/apps/returns/guest-lookup", actorId: "guest" });
        rateLimitResultaat = { overschreden: false, huidigAantal: 0, maxPogingen: 5, retryAfterSeconds: null };
      }

      if (rateLimitResultaat.overschreden) {
        await constanteTijdVertraging(start);
        logVerzoek({ method: "POST", path: "/apps/returns/guest-lookup", status: 429, duration_ms: stopTimer(start), actorId: clientIp });
        return Response.json(
          { error: { code: "rate_limited", message: "Te veel pogingen. Probeer het later opnieuw." } },
          {
            status: 429,
            headers: {
              "Retry-After": String(rateLimitResultaat.retryAfterSeconds ?? 900),
            },
          },
        );
      }

      // Stap 3: Parseer en valideer aanvraagtekst
      let aanvraagTekst: unknown;
      try {
        aanvraagTekst = await request.json();
      } catch {
        await constanteTijdVertraging(start);
        return maakFoutAntwoord(400, "validation_failed", "Ongeldige JSON in aanvraagtekst");
      }

      const validatieResultaat = parseValideer(GuestLookupSchema, aanvraagTekst);
      if (!validatieResultaat.succes) {
        await constanteTijdVertraging(start);
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
            // Stap 5: Zoek bestelling op naam + e-mail
            const bestelling = await haalBestellingOpNaamEnEmail(
              invoer.orderName,
              invoer.email,
            );

            if (!bestelling) {
              // Constante tijdvertraging om timing-aanvallen te voorkomen
              await constanteTijdVertraging(start);
              return {
                status: 200,
                body: { found: false },
              };
            }

            // Stap 6: Controleer retourgeschiktheid (alle items)
            const lineItemIds = bestelling.lineItems.map((l) => l.id);
            const geschiktheid = await checkEligibility({
              shopifyOrder: bestelling,
              lineItemIds,
            });

            // Stap 7: Genereer kortlopend JWT
            const token = await genereerGastToken(bestelling.id, invoer.email);

            await constanteTijdVertraging(start);
            return {
              status: 200,
              body: {
                found: true,
                token,
                eligibility: {
                  eligible: geschiktheid.eligible,
                  reasons: geschiktheid.reasons,
                  windowDays: geschiktheid.windowDays,
                  windowExpiresAt: geschiktheid.windowExpiresAt?.toISOString() ?? null,
                },
                lineItems: bestelling.lineItems.map((item) => ({
                  id: item.id,
                  productTitle: item.productTitle,
                  variantTitle: item.variantTitle ?? null,
                  quantity: item.quantity,
                  unitPrice: item.discountedUnitPrice,
                })),
              },
            };
          },
        );

        logVerzoek({
          method: "POST",
          path: "/apps/returns/guest-lookup",
          status: resultaat.status,
          duration_ms: stopTimer(start),
          actorId: "guest",
          cached: resultaat.cached,
        });

        return Response.json(resultaat.body, { status: resultaat.status });
      } catch (fout) {
        if (fout instanceof IdempotencyMismatchFout) {
          await constanteTijdVertraging(start);
          return maakFoutAntwoord(409, "idempotency_key_reused_for_different_endpoint",
            "Deze idempotency-sleutel is al gebruikt voor een ander eindpunt");
        }

        logFout(fout, { method: "POST", path: "/apps/returns/guest-lookup", actorId: "guest", duration_ms: stopTimer(start) });
        Sentry.captureException(fout);
        await constanteTijdVertraging(start);
        return maakFoutAntwoord(500, "internal_error", "Interne serverfout");
      }
    },
  );
}

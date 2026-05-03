/**
 * Klaviyo Events client — JANICE Returns & Exchanges app
 *
 * Verstuurt lifecycle-events voor het retourproces naar Klaviyo via de
 * Events API v3 (revisie 2024-10-15).
 *
 * Als KLAVIYO_PRIVATE_KEY ontbreekt, wordt een waarschuwing gelogd en
 * keert de functie vroeg terug — Klaviyo-storingen mogen het retourproces
 * NOOIT blokkeren.
 *
 * 9 lifecycle-events:
 *  1. Return_Started       — DRAFT aangemaakt via /start
 *  2. Return_Submitted     — DRAFT → SUBMITTED via /submit
 *  3. Return_Approved      — SUBMITTED → APPROVED
 *  4. Return_Rejected      — SUBMITTED→REJECTED of INSPECTING→REJECTED
 *  5. Return_Label_Issued  — APPROVED → LABEL_ISSUED (DHL-label beschikbaar)
 *  6. Return_In_Transit    — LABEL_ISSUED → IN_TRANSIT
 *  7. Return_Received      — IN_TRANSIT → RECEIVED
 *  8. Return_Completed     — INSPECTING → COMPLETED
 *  9. Return_Expired       — LABEL_ISSUED → EXPIRED
 */

import * as Sentry from "@sentry/node";

// ---------------------------------------------------------------------------
// Event-naam union type
// ---------------------------------------------------------------------------

export const KLAVIYO_EVENT_NAMEN = [
  "Return_Started",
  "Return_Submitted",
  "Return_Approved",
  "Return_Rejected",
  "Return_Label_Issued",
  "Return_In_Transit",
  "Return_Received",
  "Return_Completed",
  "Return_Expired",
] as const;

export type KlaviyoEventName = (typeof KLAVIYO_EVENT_NAMEN)[number];

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface KlaviyoEvent {
  /** Naam van het lifecycle-event */
  eventName: KlaviyoEventName;
  /** E-mailadres van de klant (vereist voor profiel-koppeling) */
  customerEmail: string;
  /** Shopify customer GID (optioneel) */
  customerId?: string;
  /** Event-eigenschappen — worden meegegeven aan het Klaviyo-profiel */
  properties: KlaviyoEventProperties;
  /** Uniek ID voor idempotentie aan Klaviyo-zijde */
  uniqueId?: string;
}

export interface KlaviyoEventProperties {
  return_id: string;
  order_name: string;
  total_refund_amount: string | number;
  currency: string;
  resolution?: string | null;
  state: string;
  reason_codes: string[];
  /** Aanwezig bij Return_Label_Issued */
  tracking_number?: string;
  /** Aanwezig bij Return_Completed */
  final_refund_amount?: string | number;
  /** Extra velden toegestaan */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Klaviyo API-configuratie
// ---------------------------------------------------------------------------

const KLAVIYO_API_URL = "https://a.klaviyo.com/api/events/";
const KLAVIYO_REVISION = "2024-10-15";
const REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Hoofd-functie: event versturen
// ---------------------------------------------------------------------------

/**
 * Stuur een lifecycle-event naar Klaviyo.
 *
 * Retourneert vroeg (zonder fout te gooien) als KLAVIYO_PRIVATE_KEY ontbreekt.
 * 4xx-fouten worden gelogd en doorgegeven als Error.
 * Netwerk-/timeout-fouten worden doorgegeven als Error.
 */
export async function trackEvent(event: KlaviyoEvent): Promise<void> {
  const apiKey = process.env.KLAVIYO_PRIVATE_KEY ?? process.env.KLAVIYO_PRIVATE_API_KEY ?? "";

  if (!apiKey) {
    process.stderr.write(
      JSON.stringify({
        level: "WARN",
        ts: new Date().toISOString(),
        event: "klaviyo_not_configured",
        message: "KLAVIYO_PRIVATE_KEY ontbreekt — event wordt overgeslagen",
        klaviyo_event: event.eventName,
        return_id: event.properties.return_id,
      }) + "\n",
    );
    return;
  }

  return Sentry.startSpan(
    {
      op: "http.client",
      name: `Klaviyo trackEvent ${event.eventName}`,
      attributes: {
        "klaviyo.event": event.eventName,
        "return.id": event.properties.return_id,
        "customer.email": event.customerEmail,
      },
    },
    async () => {
      const aanvraagBody = bouwKlaviyoBody(event);

      // Log de aanvraag (zonder API-sleutel)
      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "klaviyo_event_sending",
          klaviyo_event: event.eventName,
          return_id: event.properties.return_id,
          customer_email: event.customerEmail,
        }) + "\n",
      );

      const reactie = await fetch(KLAVIYO_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Klaviyo-API-Key ${apiKey}`,
          "revision": KLAVIYO_REVISION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(aanvraagBody),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // Klaviyo retourneert 202 Accepted bij succes (geen body)
      if (!reactie.ok) {
        const body = await reactie.json().catch(() => null);
        process.stderr.write(
          JSON.stringify({
            level: "ERROR",
            ts: new Date().toISOString(),
            event: "klaviyo_event_error",
            klaviyo_event: event.eventName,
            return_id: event.properties.return_id,
            status: reactie.status,
          }) + "\n",
        );
        throw new Error(
          `Klaviyo event-verzending mislukt (${reactie.status}): ${JSON.stringify(body)}`,
        );
      }

      // Succes — 202 Accepted
      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "klaviyo_event_sent",
          klaviyo_event: event.eventName,
          return_id: event.properties.return_id,
        }) + "\n",
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Klaviyo API v3 body-builder
// ---------------------------------------------------------------------------

/**
 * Bouw de Klaviyo Events API v3 aanvraag-body.
 * Conformeer aan de datastructuur: data.type='event', metric, profile.
 */
function bouwKlaviyoBody(event: KlaviyoEvent): object {
  return {
    data: {
      type: "event",
      attributes: {
        properties: event.properties,
        time: new Date().toISOString(),
        value: typeof event.properties.total_refund_amount === "number"
          ? event.properties.total_refund_amount
          : parseFloat(String(event.properties.total_refund_amount)) || 0,
        unique_id: event.uniqueId,
        metric: {
          data: {
            type: "metric",
            attributes: {
              name: event.eventName,
            },
          },
        },
        profile: {
          data: {
            type: "profile",
            attributes: {
              email: event.customerEmail,
              ...(event.customerId && { external_id: event.customerId }),
            },
          },
        },
      },
    },
  };
}

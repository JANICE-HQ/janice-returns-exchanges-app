/**
 * Return Orchestrator — JANICE Returns & Exchanges app
 *
 * Verwerkt side-effects na een succesvolle state-overgang in de state machine.
 * Wordt aangeroepen door transition() NADAT de DB-schrijfoperatie geslaagd is.
 *
 * Side-effects per transitie:
 *   * → SUBMITTED          → Klaviyo Return_Submitted
 *   SUBMITTED → APPROVED   → Klaviyo Return_Approved + BullMQ IssueLabelJob
 *   SUBMITTED → REJECTED   → Klaviyo Return_Rejected
 *   APPROVED → LABEL_ISSUED → Klaviyo Return_Label_Issued (via IssueLabelJob)
 *   LABEL_ISSUED → IN_TRANSIT → Klaviyo Return_In_Transit
 *   IN_TRANSIT → RECEIVED   → Klaviyo Return_Received
 *   INSPECTING → COMPLETED  → Store Credit (bij store_credit) + Klaviyo Return_Completed
 *                             TODO (toekomstige PR): Mollie-terugbetaling
 *                             TODO (toekomstige PR): Ruil-order aanmaken
 *   INSPECTING → REJECTED   → Klaviyo Return_Rejected
 *   LABEL_ISSUED → EXPIRED   → Klaviyo Return_Expired
 *
 * BELANGRIJK: Side-effects mogen de state-transitie NOOIT doen mislukken.
 * Alle aanroepen zijn omsloten door try/catch + Sentry.captureException.
 */

import * as Sentry from "@sentry/node";
import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { returns, returnItems } from "../../db/schema.js";
import type { State } from "./return-state-machine.js";
import { trackEvent } from "~/lib/klaviyo/events.server";
import type { KlaviyoEventProperties } from "~/lib/klaviyo/events.server";
import { creditCustomer } from "~/lib/shopify/store-credit.server";
import { enqueueIssueLabelJob } from "~/lib/queues/issue-label-job";
import { logFout } from "~/lib/structured-logger.server";

// ---------------------------------------------------------------------------
// Context-type voor de orchestrator
// ---------------------------------------------------------------------------

export interface TransitionContext {
  /** E-mailadres van de klant */
  customerEmail: string;
  /** Shopify customer GID (optioneel — null voor gasten) */
  customerId?: string | null;
  /** Bestelnummer, bijv. "#1042" */
  orderName: string;
  /** Totaal terugbetalingsbedrag als string (EUR) */
  totalRefundAmount?: string | null;
  /** Gekozen afhandeling: 'refund' | 'exchange' | 'store_credit' */
  resolution?: string | null;
  /** DHL-trackingnummer (aanwezig na LABEL_ISSUED) */
  trackingNumber?: string | null;
  /** Redencodes van de retourartikelen */
  reasonCodes?: string[];
}

// ---------------------------------------------------------------------------
// Hoofd-functie: verwerk state-overgang side-effects
// ---------------------------------------------------------------------------

/**
 * Verwerk alle side-effects voor een state-overgang.
 *
 * Fouten in side-effects worden gelogd en naar Sentry gestuurd,
 * maar gooien NOOIT naar de aanroeper terug.
 *
 * @param returnId  - ID van het retourverzoek
 * @param fromState - Vorige state
 * @param toState   - Nieuwe state
 * @param context   - Aanvullende context voor events en acties
 */
export async function onStateTransition(
  returnId: string,
  fromState: State | null,
  toState: State,
  context: TransitionContext,
): Promise<void> {
  try {
    await verwerkSideEffects(returnId, fromState, toState, context);
  } catch (fout) {
    // Side-effects mogen nooit de transitie-aanroeper doen mislukken
    logFout(fout, {
      method: "orchestrator",
      path: `state-overgang ${fromState} → ${toState}`,
      actorId: "orchestrator",
      returnId,
    });
    Sentry.captureException(fout, {
      tags: {
        "return.id": returnId,
        "transition.from": fromState ?? "null",
        "transition.to": toState,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Interne side-effect router
// ---------------------------------------------------------------------------

async function verwerkSideEffects(
  returnId: string,
  fromState: State | null,
  toState: State,
  context: TransitionContext,
): Promise<void> {
  const eigenschappen = await bouwEventEigenschappen(returnId, toState, context);

  switch (toState) {
    case "SUBMITTED": {
      await verzetKlaviyo("Return_Submitted", returnId, context, eigenschappen);
      break;
    }

    case "APPROVED": {
      await verzetKlaviyo("Return_Approved", returnId, context, eigenschappen);
      // Stuur BullMQ-job om DHL-label aan te maken
      await verzetIssueLabelJob(returnId);
      break;
    }

    case "REJECTED": {
      await verzetKlaviyo("Return_Rejected", returnId, context, eigenschappen);
      break;
    }

    case "LABEL_ISSUED": {
      const eigenschappenMetTracking: KlaviyoEventProperties = {
        ...eigenschappen,
        ...(context.trackingNumber && { tracking_number: context.trackingNumber }),
      };
      await verzetKlaviyo("Return_Label_Issued", returnId, context, eigenschappenMetTracking);
      break;
    }

    case "IN_TRANSIT": {
      await verzetKlaviyo("Return_In_Transit", returnId, context, eigenschappen);
      break;
    }

    case "RECEIVED": {
      await verzetKlaviyo("Return_Received", returnId, context, eigenschappen);
      break;
    }

    case "COMPLETED": {
      // Verwerk op basis van resolutie
      if (context.resolution === "store_credit" && context.customerId) {
        await verzetStoreCredit(returnId, context);
      } else if (context.resolution === "refund") {
        // TODO (toekomstige PR): Mollie-terugbetaling uitvoeren
        // await mollieRefund({ returnId, amount: context.totalRefundAmount, customerId: context.customerId });
        process.stdout.write(
          JSON.stringify({
            level: "INFO",
            ts: new Date().toISOString(),
            event: "mollie_refund_stub",
            return_id: returnId,
            message: "TODO: Mollie-terugbetaling — wordt geïmplementeerd in toekomstige PR",
          }) + "\n",
        );
      } else if (context.resolution === "exchange") {
        // TODO (toekomstige PR): Ruil-order aanmaken in Shopify
        // await createExchangeOrder({ returnId, customerId: context.customerId });
        process.stdout.write(
          JSON.stringify({
            level: "INFO",
            ts: new Date().toISOString(),
            event: "exchange_order_stub",
            return_id: returnId,
            message: "TODO: Ruil-order aanmaken — wordt geïmplementeerd in toekomstige PR",
          }) + "\n",
        );
      }

      const voltooiEigenschappen: KlaviyoEventProperties = {
        ...eigenschappen,
        ...(context.totalRefundAmount && {
          final_refund_amount: context.totalRefundAmount,
        }),
      };
      await verzetKlaviyo("Return_Completed", returnId, context, voltooiEigenschappen);
      break;
    }

    case "EXPIRED": {
      await verzetKlaviyo("Return_Expired", returnId, context, eigenschappen);
      break;
    }

    // States zonder side-effects
    case "DRAFT":
    case "CANCELLED":
    case "INSPECTING":
    case "IN_TRANSIT":
      // Geen side-effect voor DRAFT, CANCELLED, INSPECTING (enkel transitie-logging)
      break;
  }
}

// ---------------------------------------------------------------------------
// Hulpfuncties voor individuele side-effects
// ---------------------------------------------------------------------------

/**
 * Stuur een Klaviyo-event — omsloten door try/catch.
 * Klaviyo-fouten mogen de orchestrator nooit doen mislukken.
 */
async function verzetKlaviyo(
  eventNaam: Parameters<typeof trackEvent>[0]["eventName"],
  returnId: string,
  context: TransitionContext,
  eigenschappen: KlaviyoEventProperties,
): Promise<void> {
  try {
    await trackEvent({
      eventName: eventNaam,
      customerEmail: context.customerEmail,
      customerId: context.customerId ?? undefined,
      properties: eigenschappen,
      uniqueId: `${returnId}:${eventNaam}`,
    });
  } catch (fout) {
    logFout(fout, {
      method: "orchestrator",
      path: "klaviyo_event",
      actorId: "orchestrator",
      returnId,
      klaviyo_event: eventNaam,
    });
    Sentry.captureException(fout, {
      tags: {
        "return.id": returnId,
        "klaviyo.event": eventNaam,
      },
    });
  }
}

/**
 * Stuur een BullMQ IssueLabelJob — omsloten door try/catch.
 */
async function verzetIssueLabelJob(returnId: string): Promise<void> {
  try {
    await enqueueIssueLabelJob({ returnId });
  } catch (fout) {
    logFout(fout, {
      method: "orchestrator",
      path: "issue_label_job",
      actorId: "orchestrator",
      returnId,
    });
    Sentry.captureException(fout, {
      tags: {
        "return.id": returnId,
        "job.type": "IssueLabelJob",
      },
    });
  }
}

/**
 * Schrijf winkelkrediet bij — omsloten door try/catch.
 */
async function verzetStoreCredit(
  returnId: string,
  context: TransitionContext,
): Promise<void> {
  if (!context.customerId) {
    process.stderr.write(
      JSON.stringify({
        level: "WARN",
        ts: new Date().toISOString(),
        event: "store_credit_skipped",
        return_id: returnId,
        message: "Geen customerId beschikbaar voor store_credit — slaat over",
      }) + "\n",
    );
    return;
  }

  // Gebruik Decimal.js om float-drift te vermijden bij bedragen zoals 0.1 + 0.2
  const bedrag = new Decimal(context.totalRefundAmount ?? "0").toFixed(2);
  if (new Decimal(bedrag).lte(0)) {
    process.stderr.write(
      JSON.stringify({
        level: "WARN",
        ts: new Date().toISOString(),
        event: "store_credit_zero_amount",
        return_id: returnId,
        message: "Bedrag is nul of negatief — winkelkrediet wordt overgeslagen",
      }) + "\n",
    );
    return;
  }

  try {
    await creditCustomer({
      customerId: context.customerId,
      amount: new Decimal(bedrag).toNumber(),
      currency: "EUR",
      reason: `Retourvergoeding voor retour ${returnId}`,
      returnId,
    });
  } catch (fout) {
    logFout(fout, {
      method: "orchestrator",
      path: "store_credit",
      actorId: "orchestrator",
      returnId,
    });
    Sentry.captureException(fout, {
      tags: {
        "return.id": returnId,
        "action": "store_credit",
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Hulpfunctie: laad retour-context voor event-eigenschappen
// ---------------------------------------------------------------------------

/**
 * Bouw de Klaviyo event-eigenschappen op basis van de DB-data.
 */
async function bouwEventEigenschappen(
  returnId: string,
  toState: State,
  context: TransitionContext,
): Promise<KlaviyoEventProperties> {
  // Laad redencodes als niet meegeleverd
  let reasonCodes = context.reasonCodes ?? [];

  if (reasonCodes.length === 0) {
    try {
      const items = await db
        .select({ reasonCode: returnItems.reasonCode })
        .from(returnItems)
        .where(eq(returnItems.returnId, returnId));
      reasonCodes = items.map((i) => i.reasonCode);
    } catch {
      // Niet-kritiek — lege array is acceptabel
    }
  }

  return {
    return_id: returnId,
    order_name: context.orderName,
    total_refund_amount: context.totalRefundAmount ?? "0.00",
    currency: "EUR",
    resolution: context.resolution ?? null,
    state: toState,
    reason_codes: reasonCodes,
  };
}

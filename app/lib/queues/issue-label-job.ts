/**
 * BullMQ IssueLabelJob — JANICE Returns & Exchanges app
 *
 * Verwerkt het aanmaken van DHL-retourlabels asynchroon.
 *
 * Gedrag:
 *  1. Laad retour + retourartikelen + klantadres uit DB
 *  2. Roep DHL createReturnLabel() aan
 *  3. Update returns.dhl_label_url, dhl_tracking_number, expires_at
 *  4. Transitie state APPROVED → LABEL_ISSUED (triggert Klaviyo via orchestrator)
 *
 * Herstelbeleid: 3 pogingen, exponentiële backoff (1 min → 2 min → 4 min).
 * Bij uitgeputte pogingen: log naar Sentry + laat retour in APPROVED-state.
 */

import { Queue, Worker, type Job } from "bullmq";
import * as Sentry from "@sentry/node";
import { eq } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { returns } from "../../../db/schema.js";
import { createReturnLabel } from "~/lib/dhl/parcel-nl.server";
import type { Address } from "~/lib/dhl/parcel-nl.server";
import { transition } from "~/services/return-state-machine";
import { logFout } from "~/lib/structured-logger.server";

// ---------------------------------------------------------------------------
// Queue-configuratie
// ---------------------------------------------------------------------------

export const ISSUE_LABEL_QUEUE_NAME = "issue-label";

export interface IssueLabelJobData {
  returnId: string;
}

// Standaard GoedGepickt-magazijnadres (ontvanger van retouren)
// Sean vult het exacte adres in wanneer GoedGepickt-integratie live gaat
const GOEDGEPICKT_MAGAZIJNADRES: Address = {
  name: process.env.GOEDGEPICKT_WAREHOUSE_NAME ?? "JANICE Retourcentrum",
  addressLine1: process.env.GOEDGEPICKT_WAREHOUSE_ADDRESS ?? "Magazijnstraat 1",
  postalCode: process.env.GOEDGEPICKT_WAREHOUSE_POSTALCODE ?? "1000 AA",
  city: process.env.GOEDGEPICKT_WAREHOUSE_CITY ?? "Amsterdam",
  countryCode: "NL",
};

// ---------------------------------------------------------------------------
// Queue-instantie (lazy — pas aanmaken als Redis beschikbaar is)
// ---------------------------------------------------------------------------

let issueLabelQueue: Queue<IssueLabelJobData> | null = null;

function haalIssueLabelQueue(): Queue<IssueLabelJobData> {
  if (!issueLabelQueue) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is vereist voor BullMQ-queues");
    }

    issueLabelQueue = new Queue<IssueLabelJobData>(ISSUE_LABEL_QUEUE_NAME, {
      connection: {
        url: redisUrl,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 60_000, // 1 min → 2 min → 4 min
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return issueLabelQueue;
}

// ---------------------------------------------------------------------------
// Publieke API: job in de queue plaatsen
// ---------------------------------------------------------------------------

/**
 * Zet een IssueLabelJob in de queue.
 * Wordt aangeroepen door de orchestrator na SUBMITTED → APPROVED transitie.
 */
export async function enqueueIssueLabelJob(data: IssueLabelJobData): Promise<void> {
  const queue = haalIssueLabelQueue();

  await queue.add("issue-label", data, {
    jobId: `issue-label:${data.returnId}`,
    // Voorkom dubbele verwerking van hetzelfde retour
    // BullMQ verwerpt jobs met een bestaand jobId dat nog actief is
  });

  process.stdout.write(
    JSON.stringify({
      level: "INFO",
      ts: new Date().toISOString(),
      event: "issue_label_job_queued",
      return_id: data.returnId,
      queue: ISSUE_LABEL_QUEUE_NAME,
    }) + "\n",
  );
}

// ---------------------------------------------------------------------------
// Job-verwerker
// ---------------------------------------------------------------------------

/**
 * Verwerk een IssueLabelJob.
 *
 * 1. Laad retour uit DB
 * 2. Maak DHL-label aan
 * 3. Update DB
 * 4. Transitie naar LABEL_ISSUED (triggert Klaviyo via orchestrator)
 */
export async function processIssueLabel(
  job: Job<IssueLabelJobData>,
): Promise<void> {
  const { returnId } = job.data;

  return Sentry.startSpan(
    {
      op: "queue.process",
      name: "IssueLabelJob",
      attributes: {
        "return.id": returnId,
        "job.id": job.id ?? "unknown",
        "job.attempt": job.attemptsMade + 1,
      },
    },
    async () => {
      // Stap 1: Laad retour uit DB
      const [retour] = await db
        .select()
        .from(returns)
        .where(eq(returns.id, returnId))
        .limit(1);

      if (!retour) {
        throw new Error(`Retour ${returnId} niet gevonden in DB`);
      }

      if (retour.state !== "APPROVED") {
        process.stdout.write(
          JSON.stringify({
            level: "WARN",
            ts: new Date().toISOString(),
            event: "issue_label_job_skip",
            return_id: returnId,
            state: retour.state,
            message: `Retour is niet in APPROVED-state — job wordt overgeslagen`,
          }) + "\n",
        );
        return;
      }

      // Klantadres als afzender (van DB of placeholder)
      const klantAdres: Address = {
        name: retour.customerEmail,
        addressLine1: process.env.DEFAULT_SENDER_ADDRESS ?? "Onbekend adres 1",
        postalCode: "1000 AA",
        city: "Amsterdam",
        countryCode: "NL",
        email: retour.customerEmail,
      };

      // Stap 2: Maak DHL-label aan
      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "issue_label_job_start",
          return_id: returnId,
          attempt: job.attemptsMade + 1,
        }) + "\n",
      );

      const labelResultaat = await createReturnLabel({
        returnId,
        receiverWarehouseAddress: GOEDGEPICKT_MAGAZIJNADRES,
        senderCustomerAddress: klantAdres,
        weight: 500,
        isQrPrintless: true,
      });

      // Stap 3: Update DB met label-informatie
      await db
        .update(returns)
        .set({
          dhlTrackingNumber: labelResultaat.trackingNumber,
          dhlLabelUrl: labelResultaat.labelUrl ?? labelResultaat.qrToken ?? null,
          expiresAt: labelResultaat.expiresAt,
          returnMethod: labelResultaat.qrToken ? "dhl_qr" : "dhl_label",
          updatedAt: new Date(),
        })
        .where(eq(returns.id, returnId));

      // Stap 4: Transitie naar LABEL_ISSUED
      // De orchestrator wordt automatisch aangeroepen door transition()
      // en stuurt het Return_Label_Issued Klaviyo-event
      await transition(
        returnId,
        "LABEL_ISSUED",
        { type: "system" },
        "DHL-retourlabel aangemaakt",
        {
          trackingNumber: labelResultaat.trackingNumber,
          labelUrl: labelResultaat.labelUrl,
          qrToken: labelResultaat.qrToken,
        },
      );

      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "issue_label_job_completed",
          return_id: returnId,
          tracking_number: labelResultaat.trackingNumber,
        }) + "\n",
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Worker-bootstrap
// ---------------------------------------------------------------------------

let issueLabelWorker: Worker<IssueLabelJobData> | null = null;

/**
 * Start de IssueLabelJob-worker.
 * Wordt aangeroepen vanuit worker.ts als RUN_WORKERS=true.
 */
export function startIssueLabelWorker(): Worker<IssueLabelJobData> {
  if (issueLabelWorker) {
    return issueLabelWorker;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is vereist voor BullMQ-workers");
  }

  issueLabelWorker = new Worker<IssueLabelJobData>(
    ISSUE_LABEL_QUEUE_NAME,
    processIssueLabel,
    {
      connection: {
        url: redisUrl,
      },
      concurrency: 2,
      autorun: true,
    },
  );

  issueLabelWorker.on("completed", (job) => {
    process.stdout.write(
      JSON.stringify({
        level: "INFO",
        ts: new Date().toISOString(),
        event: "worker_job_completed",
        job_id: job.id,
        return_id: job.data.returnId,
      }) + "\n",
    );
  });

  issueLabelWorker.on("failed", (job, fout) => {
    const returnId = job?.data.returnId ?? "unknown";
    logFout(fout, {
      method: "worker",
      path: "issue_label",
      actorId: "worker",
      returnId,
      job_id: job?.id,
      attempt: job?.attemptsMade,
    });

    // Na uitgeputte pogingen: stuur naar Sentry
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      Sentry.captureException(fout, {
        tags: {
          "return.id": returnId,
          "job.type": "IssueLabelJob",
          "job.final_failure": "true",
        },
      });

      process.stderr.write(
        JSON.stringify({
          level: "ERROR",
          ts: new Date().toISOString(),
          event: "issue_label_job_final_failure",
          return_id: returnId,
          message: "Maximale pogingen bereikt — retour blijft in APPROVED-state. Handmatige actie vereist.",
          error: fout instanceof Error ? fout.message : String(fout),
        }) + "\n",
      );
    }
  });

  process.stdout.write(
    JSON.stringify({
      level: "INFO",
      ts: new Date().toISOString(),
      event: "worker_started",
      queue: ISSUE_LABEL_QUEUE_NAME,
    }) + "\n",
  );

  return issueLabelWorker;
}

/**
 * BullMQ RefreshShopifyTokenJob — JANICE Returns & Exchanges app
 *
 * Herhaaltaak die elke 4 uur het Shopify Admin token proactief vernieuwt.
 *
 * Rationale voor 4u-cadans:
 *   - Token is 24u geldig → 6 pogingen per tokenleven = hoge redundantie
 *   - De token manager vernieuwt alleen als TTL < 5 minuten → job is idempotent
 *   - 4u is ruim boven de 5-minutenmarge, maar klein genoeg om snel te herstel
 *     bij een gemiste vernieuwing (bijv. Redis-restart)
 *
 * Gedrag:
 *   - Roept getShopifyAdminToken() aan
 *   - Bijwerking: als gecachte token bijna verlopen is, wordt het vernieuwd
 *   - Logt verloopdatum van het huidige/nieuwe token voor audittrail
 *
 * Herstelbeleid: 3 pogingen, exponentieel (1 min → 2 min → 4 min).
 * Bij finale mislukking: Sentry-fout + token blijft verlopen → shopifyAdmin() gooit 401.
 */

import { Queue, Worker, type Job } from "bullmq";
import * as Sentry from "@sentry/node";
import { getShopifyAdminToken, REDIS_KEY } from "~/lib/shopify-token-manager.server";
import { redis } from "~/lib/redis.server";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/** Job-data — leeg record, job heeft geen parameters nodig */
export type RefreshShopifyTokenJobData = Record<string, never>;

// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------

export const REFRESH_SHOPIFY_TOKEN_QUEUE_NAME = "refresh-shopify-token";

/** Herhalingsinterval: elke 4 uur in milliseconden */
export const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Singleton job-ID voor de herhaaltaak */
export const REFRESH_JOB_ID = "shopify-token-refresh-cron";

// ---------------------------------------------------------------------------
// Queue-instantie (lazy)
// ---------------------------------------------------------------------------

let refreshQueue: Queue<RefreshShopifyTokenJobData> | null = null;

function haalRefreshQueue(): Queue<RefreshShopifyTokenJobData> {
  if (!refreshQueue) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is vereist voor BullMQ-queues");
    }

    refreshQueue = new Queue<RefreshShopifyTokenJobData>(
      REFRESH_SHOPIFY_TOKEN_QUEUE_NAME,
      {
        connection: { url: redisUrl },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 60_000, // 1 min → 2 min → 4 min
          },
          removeOnComplete: true,
          removeOnFail: false, // bewaar mislukte jobs voor diagnose
        },
      },
    );
  }
  return refreshQueue;
}

// ---------------------------------------------------------------------------
// Job-verwerker
// ---------------------------------------------------------------------------

/**
 * Verwerk een RefreshShopifyTokenJob.
 *
 * Roept getShopifyAdminToken() aan — dit vernieuwt het token als het bijna verlopen is.
 * Logt de verloopdatum van het huidige of vernieuwde token.
 */
export async function processRefreshShopifyToken(
  _job: Job<RefreshShopifyTokenJobData>,
): Promise<void> {
  process.stdout.write(
    JSON.stringify({
      level: "INFO",
      ts: new Date().toISOString(),
      event: "shopify_token_refresh_job_start",
      message: "Proactieve Shopify token-vernieuwing gestart",
    }) + "\n",
  );

  // getShopifyAdminToken() vernieuwt het token als TTL < SAFETY_MARGIN_MS (5 min)
  // Op het moment van de 4u-job is het token hoogstwaarschijnlijk nog geldig
  // maar de functie zal vernieuwen als het token bijna verlopen is
  await getShopifyAdminToken();

  // Haal verloopdatum op uit Redis voor audit-logging
  try {
    const raw = await redis.get(REDIS_KEY);
    if (raw) {
      const tokenInfo = JSON.parse(raw) as { expiresAt: number; accessToken: string };
      const expiresAt = new Date(tokenInfo.expiresAt).toISOString();
      const nuOver = Math.round((tokenInfo.expiresAt - Date.now()) / 1000 / 60);

      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "shopify_token_refresh_job_voltooid",
          token_expires_at: expiresAt,
          verloopt_over_minuten: nuOver,
          message: "Shopify token-vernieuwing job voltooid",
        }) + "\n",
      );
    }
  } catch {
    // Redis-fout bij audit-log: niet fataal
  }
}

// ---------------------------------------------------------------------------
// Worker-bootstrap
// ---------------------------------------------------------------------------

let refreshWorker: Worker<RefreshShopifyTokenJobData> | null = null;

/**
 * Start de RefreshShopifyToken-worker en plan de herhaaltaak.
 * Wordt aangeroepen vanuit worker.ts.
 *
 * @returns De gestarte Worker-instantie
 */
export function startRefreshShopifyTokenWorker(): Worker<RefreshShopifyTokenJobData> {
  if (refreshWorker) {
    return refreshWorker;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is vereist voor BullMQ-workers");
  }

  refreshWorker = new Worker<RefreshShopifyTokenJobData>(
    REFRESH_SHOPIFY_TOKEN_QUEUE_NAME,
    processRefreshShopifyToken,
    {
      connection: { url: redisUrl },
      concurrency: 1, // slechts één vernieuwing tegelijk
      autorun: true,
    },
  );

  refreshWorker.on("completed", (_job) => {
    process.stdout.write(
      JSON.stringify({
        level: "INFO",
        ts: new Date().toISOString(),
        event: "shopify_token_refresh_worker_voltooid",
        message: "Shopify token-vernieuwing worker: job voltooid",
      }) + "\n",
    );
  });

  refreshWorker.on("failed", (job, fout) => {
    process.stderr.write(
      JSON.stringify({
        level: "ERROR",
        ts: new Date().toISOString(),
        event: "shopify_token_refresh_worker_mislukt",
        job_id: job?.id,
        attempt: job?.attemptsMade,
        error: fout instanceof Error ? fout.message : String(fout),
        message: "Shopify token-vernieuwing mislukt — controleer credentials en Redis",
      }) + "\n",
    );

    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      Sentry.captureException(fout, {
        tags: {
          "job.type": "RefreshShopifyTokenJob",
          "job.final_failure": "true",
        },
      });
    }
  });

  process.stdout.write(
    JSON.stringify({
      level: "INFO",
      ts: new Date().toISOString(),
      event: "shopify_token_refresh_worker_gestart",
      queue: REFRESH_SHOPIFY_TOKEN_QUEUE_NAME,
    }) + "\n",
  );

  return refreshWorker;
}

/**
 * Plan de herhaaltaak in BullMQ.
 * Singleton via jobId — BullMQ vervangt de bestaande job als het patroon overeenkomt.
 *
 * @param queue - De Queue-instantie om de job aan toe te voegen
 */
export async function planRefreshShopifyTokenJob(
  queue: Queue<RefreshShopifyTokenJobData>,
): Promise<void> {
  const volgendeUitvoering = new Date(Date.now() + REFRESH_INTERVAL_MS).toISOString();

  await queue.add(
    "refresh-shopify-token",
    {},
    {
      repeat: { every: REFRESH_INTERVAL_MS },
      jobId: REFRESH_JOB_ID,
      removeOnComplete: true,
      removeOnFail: false,
    },
  );

  process.stdout.write(
    JSON.stringify({
      level: "INFO",
      ts: new Date().toISOString(),
      event: "shopify_token_refresh_scheduled",
      interval_ms: REFRESH_INTERVAL_MS,
      next_run: volgendeUitvoering,
      message: `Shopify token-vernieuwing gepland elke ${REFRESH_INTERVAL_MS / 1000 / 60 / 60} uur`,
    }) + "\n",
  );
}

/**
 * Haal de queue op voor planningsdoeleinden.
 * Exporteer voor gebruik in worker.ts.
 */
export { haalRefreshQueue };

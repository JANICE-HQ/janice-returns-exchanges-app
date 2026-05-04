/**
 * Worker bootstrap — JANICE Returns & Exchanges app
 *
 * Start alle BullMQ-workers als RUN_WORKERS=true is ingesteld.
 *
 * In productie (sprint 2): workers draaien in een apart containerproces.
 * In V1: workers draaien in hetzelfde Node.js-proces als de applicatie.
 *
 * Omgevingsvariabele:
 *   RUN_WORKERS=true  — start workers in hetzelfde proces (V1)
 *   RUN_WORKERS=false — workers worden niet gestart (standaard)
 *
 * Workers:
 *   - issue-label: DHL-retourlabels aanmaken na goedkeuring
 *   - refresh-shopify-token: Shopify Admin token proactief vernieuwen (elke 4u)
 *
 * Graceful shutdown:
 *   SIGTERM-handler wacht tot lopende jobs klaar zijn voordat het proces stopt.
 */

import { startIssueLabelWorker } from "./issue-label-job.js";
import {
  startRefreshShopifyTokenWorker,
  planRefreshShopifyTokenJob,
  haalRefreshQueue,
  REFRESH_INTERVAL_MS,
} from "./refresh-shopify-token-job.js";

let workersGestart = false;

/**
 * Start alle BullMQ-workers als RUN_WORKERS=true.
 * Veilig om meerdere keren aan te roepen — start slechts één keer.
 */
export function bootstrapWorkers(): void {
  if (workersGestart) {
    return;
  }

  if (process.env.RUN_WORKERS !== "true") {
    process.stdout.write(
      JSON.stringify({
        level: "INFO",
        ts: new Date().toISOString(),
        event: "workers_disabled",
        message: "RUN_WORKERS is niet 'true' — workers worden niet gestart. Stel RUN_WORKERS=true in om workers te activeren.",
      }) + "\n",
    );
    return;
  }

  process.stdout.write(
    JSON.stringify({
      level: "INFO",
      ts: new Date().toISOString(),
      event: "workers_starting",
      message: "BullMQ-workers worden gestart (RUN_WORKERS=true)",
    }) + "\n",
  );

  try {
    const issueLabelWorker = startIssueLabelWorker();
    const refreshTokenWorker = startRefreshShopifyTokenWorker();

    workersGestart = true;

    process.stdout.write(
      JSON.stringify({
        level: "INFO",
        ts: new Date().toISOString(),
        event: "workers_started",
        workers: ["issue-label", "refresh-shopify-token"],
      }) + "\n",
    );

    // Plan de herhaaltaak voor Shopify token-vernieuwing
    const refreshQueue = haalRefreshQueue();
    void planRefreshShopifyTokenJob(refreshQueue).then(() => {
      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "shopify_token_refresh_scheduled",
          interval_ms: REFRESH_INTERVAL_MS,
          next_run: new Date(Date.now() + REFRESH_INTERVAL_MS).toISOString(),
          message: `Shopify token-vernieuwing ingepland — interval: ${REFRESH_INTERVAL_MS / 1000 / 60 / 60}u`,
        }) + "\n",
      );
    }).catch((fout: unknown) => {
      process.stderr.write(
        JSON.stringify({
          level: "ERROR",
          ts: new Date().toISOString(),
          event: "shopify_token_refresh_plan_fout",
          error: fout instanceof Error ? fout.message : String(fout),
          message: "Kon Shopify token-vernieuwing niet inplannen",
        }) + "\n",
      );
    });

    // Graceful shutdown: wacht op lopende jobs
    const gracefulShutdown = async (signaal: string) => {
      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "workers_shutdown_start",
          signal: signaal,
          message: "Graceful shutdown — wachten op lopende jobs",
        }) + "\n",
      );

      try {
        await Promise.all([
          issueLabelWorker.close(),
          refreshTokenWorker.close(),
        ]);

        process.stdout.write(
          JSON.stringify({
            level: "INFO",
            ts: new Date().toISOString(),
            event: "workers_shutdown_complete",
            message: "Alle workers gestopt",
          }) + "\n",
        );
      } catch (fout) {
        process.stderr.write(
          JSON.stringify({
            level: "ERROR",
            ts: new Date().toISOString(),
            event: "workers_shutdown_error",
            error: fout instanceof Error ? fout.message : String(fout),
          }) + "\n",
        );
      }
    };

    process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
  } catch (fout) {
    process.stderr.write(
      JSON.stringify({
        level: "ERROR",
        ts: new Date().toISOString(),
        event: "workers_start_failed",
        error: fout instanceof Error ? fout.message : String(fout),
        message: "Kon BullMQ-workers niet starten — controleer REDIS_URL",
      }) + "\n",
    );
  }
}

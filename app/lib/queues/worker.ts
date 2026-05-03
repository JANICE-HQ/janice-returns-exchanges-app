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
 * Graceful shutdown:
 *   SIGTERM-handler wacht tot lopende jobs klaar zijn voordat het proces stopt.
 */

import { startIssueLabelWorker } from "./issue-label-job.js";

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

    workersGestart = true;

    process.stdout.write(
      JSON.stringify({
        level: "INFO",
        ts: new Date().toISOString(),
        event: "workers_started",
        workers: ["issue-label"],
      }) + "\n",
    );

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
        await issueLabelWorker.close();

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

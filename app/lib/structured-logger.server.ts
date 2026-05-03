/**
 * Gestructureerde JSON-logger — JANICE Returns & Exchanges app
 *
 * Schrijft JSON-logs op INFO-niveau voor elk API-verzoek.
 * Formaat: { level, ts, method, path, status, duration_ms, actorId, returnId?, ... }
 *
 * Gebruik:
 *   import { logVerzoek } from "~/lib/structured-logger.server";
 *   logVerzoek({ method: "POST", path: "/apps/returns/start", status: 201, duration_ms: 42, actorId: "123" });
 */

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface VerzoekLogData {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  /** Shopify customer_id of 'guest' voor gastklanten */
  actorId: string;
  /** Return-ID als aanwezig (na aanmaken of ophalen) */
  returnId?: string;
  /** Extra velden voor debugging */
  [sleutel: string]: unknown;
}

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

/**
 * Log een API-verzoek als gestructureerde JSON.
 * Schrijft naar stdout (productie: gaat naar container-log-aggregator).
 */
export function logVerzoek(data: VerzoekLogData): void {
  const logRegel = {
    level: "INFO",
    ts: new Date().toISOString(),
    ...data,
  };
  process.stdout.write(JSON.stringify(logRegel) + "\n");
}

/**
 * Log een fout als gestructureerde JSON.
 */
export function logFout(
  error: unknown,
  context: Partial<VerzoekLogData>,
): void {
  const foutBericht =
    error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const logRegel = {
    level: "ERROR",
    ts: new Date().toISOString(),
    error: foutBericht,
    stack,
    ...context,
  };
  process.stderr.write(JSON.stringify(logRegel) + "\n");
}

/**
 * Hulpfunctie om de duur van een verzoek in milliseconden te meten.
 * Gebruik: const start = startTimer(); ... duration_ms: stopTimer(start)
 */
export function startTimer(): number {
  return Date.now();
}

export function stopTimer(start: number): number {
  return Date.now() - start;
}

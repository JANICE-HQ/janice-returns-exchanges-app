/**
 * Sentry SDK initialisatie (server-side) — JANICE Returns & Exchanges app
 *
 * Initialiseer dit module zo vroeg mogelijk — idealiter bovenaan entry.server.tsx.
 * Alle ongecatchte serverfouten worden automatisch naar Sentry gerapporteerd.
 *
 * Tags:
 *   app: 'janice-returns-exchanges'
 *   service: 'backend'
 *
 * Sample rates:
 *   development: 1.0 (alle traces)
 *   production:  0.1 (10% van traces — pas aan op basis van volume)
 */

import * as Sentry from "@sentry/node";

let geinitialiseerd = false;

/**
 * Initialiseer Sentry Node SDK.
 * Veilig om meerdere keren aan te roepen — initialiseert slechts één keer.
 */
export function initialiseerSentry(): void {
  if (geinitialiseerd) return;

  const dsn = process.env["SENTRY_DSN_RETURNS_APP"];
  const nodeEnv = process.env["NODE_ENV"] ?? "development";

  // In development/test zonder DSN: Sentry uitschakelen (geen foutmelding)
  if (!dsn) {
    if (nodeEnv !== "test") {
      console.warn(
        "[Sentry] SENTRY_DSN_RETURNS_APP niet ingesteld — Sentry-monitoring uitgeschakeld.",
      );
    }
    geinitialiseerd = true;
    return;
  }

  Sentry.init({
    dsn,
    environment: nodeEnv,

    // Trace sample rate: 100% in development, 10% in productie
    tracesSampleRate: nodeEnv === "production" ? 0.1 : 1.0,

    // Error sample rate: altijd 100% — elke fout vastleggen
    sampleRate: 1.0,

    // Tags voor snelle filtering in Sentry-dashboard
    initialScope: {
      tags: {
        app: "janice-returns-exchanges",
        service: "backend",
      },
    },

    // Gestructureerde breadcrumbs voor betere foutcontext
    attachStacktrace: true,

    // Onderdruk Sentry-debug-output in productie
    debug: nodeEnv === "development",
  });

  geinitialiseerd = true;

  if (nodeEnv !== "test") {
    console.info(
      `[Sentry] Geïnitialiseerd — omgeving: ${nodeEnv}, trace sample rate: ${nodeEnv === "production" ? "10%" : "100%"}`,
    );
  }
}

/**
 * Rapporteer een fout handmatig aan Sentry.
 * Gebruik dit voor bekende fouten die je expliciet wilt vastleggen met extra context.
 *
 * @example
 * import { rapporteerFout } from "~/lib/sentry.server";
 * rapporteerFout(error, { returnId: "abc-123", actor: "webhook" });
 */
export function rapporteerFout(
  fout: unknown,
  context?: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureException(fout);
  });
}

/**
 * Voeg een breadcrumb toe voor debugdoeleinden.
 * Handig voor het bijhouden van state-machine-overgangen.
 */
export function voegBreadcrumbToe(
  bericht: string,
  gegevens?: Record<string, unknown>,
): void {
  Sentry.addBreadcrumb({
    message: bericht,
    data: gegevens,
    timestamp: Date.now() / 1000,
  });
}

// Herexporteer Sentry voor direct gebruik indien nodig
export { Sentry };

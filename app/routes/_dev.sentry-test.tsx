/**
 * Sentry-testroute — ALLEEN in non-productie beschikbaar
 *
 * Bezoek /sentry-test om een bewuste fout te genereren en te verifiëren
 * dat Sentry-rapportage correct werkt.
 *
 * URL: /sentry-test
 *
 * BELANGRIJK: Deze route wordt uitgeschakeld in productie via de loader-guard.
 * Verwijder dit bestand NIET — het is nuttig voor staging-verificatie.
 */

import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { rapporteerFout } from "~/lib/sentry.server";

export async function loader({ request: _request }: LoaderFunctionArgs) {
  // Blokkeer toegang in productie
  if (process.env["NODE_ENV"] === "production") {
    throw data("Niet beschikbaar in productie", { status: 404 });
  }

  const mode = new URL(_request.url).searchParams.get("mode") ?? "capture";

  if (mode === "throw") {
    // Gooi een echte fout — test de automatische Sentry-integratie
    throw new Error(
      "[JANICE Sentry Test] Bewuste server-side fout — verifieer ontvangst in Sentry-dashboard",
    );
  }

  if (mode === "capture") {
    // Rapporteer handmatig een fout — test rapporteerFout()
    rapporteerFout(
      new Error(
        "[JANICE Sentry Test] Handmatige captureException — verifieer ontvangst in Sentry-dashboard",
      ),
      {
        route: "/sentry-test",
        testType: "handmatig",
        timestamp: new Date().toISOString(),
      },
    );

    return {
      status: "sentry_event_verzonden",
      bericht:
        "Sentry-event handmatig verzonden. Controleer je Sentry-dashboard.",
      instructies: [
        "Ga naar sentry.io → Jouw project → Issues",
        "Zoek op '[JANICE Sentry Test]'",
        "Verifieer dat de fout zichtbaar is",
        "Controleer tags: app=janice-returns-exchanges, service=backend",
        "Voeg ?mode=throw toe aan de URL voor een echte route-fout",
      ],
    };
  }

  return { status: "onbekende_mode" };
}

export default function SentryTestPagina({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
}) {
  return (
    <main
      style={{
        fontFamily: "monospace",
        padding: "2rem",
        maxWidth: "600px",
        margin: "0 auto",
        background: "#0A0A0A",
        color: "#FEFEFE",
        minHeight: "100vh",
      }}
    >
      <h1
        style={{
          fontSize: "1.2rem",
          marginBottom: "1rem",
          color: "#B8985E",
          letterSpacing: "0.1em",
        }}
      >
        JANICE — Sentry-testpagina
      </h1>

      <pre
        style={{
          background: "#1A1A1A",
          padding: "1rem",
          overflowX: "auto",
          fontSize: "0.85rem",
        }}
      >
        {JSON.stringify(loaderData, null, 2)}
      </pre>

      <div style={{ marginTop: "1.5rem", fontSize: "0.85rem", color: "#8A8580" }}>
        <p>Testopties:</p>
        <ul style={{ listStyle: "none", padding: 0, marginTop: "0.5rem" }}>
          <li>
            <a href="/sentry-test?mode=capture" style={{ color: "#B8985E" }}>
              ?mode=capture
            </a>{" "}
            — handmatige captureException
          </li>
          <li>
            <a href="/sentry-test?mode=throw" style={{ color: "#B8985E" }}>
              ?mode=throw
            </a>{" "}
            — loader gooit echte fout
          </li>
        </ul>
      </div>
    </main>
  );
}

/**
 * Server-side entry point — JANICE Returns & Exchanges app
 *
 * Dit bestand wordt als eerste uitgevoerd op de server bij elke render-aanvraag.
 * Sentry wordt hier geïnitialiseerd zodat alle server-side fouten worden vastgelegd.
 */

// Sentry initialiseren vóór alles — volgorde is essentieel
import { initialiseerSentry } from "~/lib/sentry.server";
initialiseerSentry();

import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import type { EntryContext } from "react-router";
import { PassThrough } from "node:stream";

const ABORT_DELAY = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    // Wacht met streamen bij bots — geef volledige HTML voor SEO
    const readyForStreaming = (userAgent && isbot(userAgent))
      ? "onAllReady"
      : "onShellReady";

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyForStreaming]() {
          shellRendered = true;
          const body = new PassThrough();

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(body as unknown as BodyInit, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Onderdruk logging tijdens shell-rendering — shell-fouten worden
          // afgehandeld door onShellError
          if (shellRendered) {
            console.error("[entry.server] Render-fout:", error);
          }
        },
      },
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

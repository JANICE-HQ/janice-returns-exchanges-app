/**
 * GET /apps/returns/success/:returnId — Bevestigingspagina
 *
 * Toont:
 * - Grote bevestigingsboodschap
 * - Retour-ID + bestelnummer
 * - 5 volgende stappen (Rule of 5/7 compliant)
 * - CTAs: terug naar account of winkel
 */

import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import "~/styles/returns-portal.css";
import { detectLocale, t, tArray } from "~/i18n";
import type { Locale } from "~/i18n";

export const meta: MetaFunction = () => [
  { title: "Retour ingediend — JANICE" },
];

interface LoaderData {
  locale: Locale;
  returnId: string;
  orderName: string | null;
  guestToken: string | null;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const locale = detectLocale(request);
  const url = new URL(request.url);
  const guestToken = url.searchParams.get("token");
  const returnId = params["returnId"] ?? "";

  let orderName: string | null = null;

  try {
    const statusUrl = new URL(
      `/apps/returns/${encodeURIComponent(returnId)}/status`,
      request.url,
    );
    if (guestToken) {
      statusUrl.searchParams.set("token", guestToken);
    }

    const statusRes = await fetch(statusUrl.href, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    });

    if (statusRes.ok) {
      const statusData = (await statusRes.json()) as { shopifyOrderName?: string };
      orderName = statusData.shopifyOrderName ?? null;
    }
  } catch {
    // Niet kritiek — doorgaan zonder bestelnummer
  }

  return Response.json({ locale, returnId, orderName, guestToken } as LoaderData);
}

export default function SuccessPage() {
  const data = useLoaderData<LoaderData>();
  const locale = data.locale ?? "nl";

  const nextSteps = tArray(locale, "success.nextSteps");

  return (
    <div className="rp-portal">
      <a href="#main-content" className="rp-portal__skip-link">
        {t(locale, "portal.skipToContent")}
      </a>

      <main id="main-content" className="rp-portal__container">
        {/* Checkmark icoon */}
        <div
          className="rp-success__check"
          aria-hidden="true"
          role="presentation"
        >
          <span className="rp-success__check-icon">&#10003;</span>
        </div>

        <header className="rp-page-header">
          <h1 className="rp-page-header__title">{t(locale, "success.title")}</h1>
          <p className="rp-page-header__subtitle">{t(locale, "success.subtitle")}</p>
        </header>

        {/* Retour-ID + bestelnummer */}
        <div style={{ marginBottom: "var(--space-5)" }}>
          <p
            className="rp-success__return-id"
            aria-label={`${t(locale, "success.returnIdLabel")}: ${data.returnId}`}
          >
            {t(locale, "success.returnIdLabel")}: <strong>{data.returnId.slice(0, 8).toUpperCase()}</strong>
          </p>
          {data.orderName && (
            <p
              style={{ fontSize: "14px", color: "var(--color-slate)" }}
              aria-label={`${t(locale, "success.orderLabel")}: ${data.orderName}`}
            >
              {t(locale, "success.orderLabel")}: {data.orderName}
            </p>
          )}
        </div>

        {/* Volgende stappen — 5 items (Rule of 5/7) */}
        <section aria-label={t(locale, "success.nextStepsTitle")}>
          <h2
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-slate)",
              marginBottom: "var(--space-4)",
            }}
          >
            {t(locale, "success.nextStepsTitle")}
          </h2>
          <ol className="rp-success__steps" aria-label={t(locale, "success.nextStepsTitle")}>
            {nextSteps.map((step, idx) => (
              <li key={idx} className="rp-success__step-item">
                <span className="rp-success__step-number" aria-hidden="true">
                  {idx + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* CTAs */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-3)",
            flexWrap: "wrap",
            marginTop: "var(--space-6)",
          }}
        >
          <a
            href="/account"
            className="rp-btn rp-btn--primary rp-btn--full-width-mobile"
          >
            {t(locale, "success.backToAccount")}
          </a>
          <a
            href="/"
            className="rp-btn rp-btn--secondary rp-btn--full-width-mobile"
          >
            {t(locale, "success.backToStore")}
          </a>
        </div>
      </main>
    </div>
  );
}

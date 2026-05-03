/**
 * GET /apps/returns/status/:returnId — Publieke statuspagina
 *
 * Read-only weergave van de retorstatus met tijdlijn.
 * Authenticatie via ?token= (gast) of ingelogde klant.
 * Tijdlijn: verticale weergave met Onyx dots en Camel accent op actieve staat.
 */

import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import "~/styles/returns-portal.css";
import { detectLocale, t } from "~/i18n";
import type { Locale } from "~/i18n";
import { Timeline } from "~/components/returns/Timeline";
import type { ReturnDetail } from "~/components/returns/types";
import { formatPrice } from "~/components/returns/types";

export const meta: MetaFunction = () => [
  { title: "Status — JANICE Retourportal" },
];

interface LoaderData {
  locale: Locale;
  returnId: string;
  returnDetail: ReturnDetail | null;
  error: string | null;
  guestToken: string | null;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const locale = detectLocale(request);
  const url = new URL(request.url);
  const guestToken = url.searchParams.get("token");
  const returnId = params["returnId"] ?? "";

  if (!returnId) {
    return Response.json(
      { locale, returnId: "", returnDetail: null, error: t(locale, "errors.notFound"), guestToken } as LoaderData,
      { status: 400 },
    );
  }

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

    if (statusRes.status === 401 || statusRes.status === 403) {
      return Response.json(
        { locale, returnId, returnDetail: null, error: t(locale, "errors.unauthorized"), guestToken } as LoaderData,
        { status: statusRes.status },
      );
    }

    if (statusRes.status === 404) {
      return Response.json(
        { locale, returnId, returnDetail: null, error: t(locale, "status.notFoundMessage"), guestToken } as LoaderData,
        { status: 404 },
      );
    }

    if (!statusRes.ok) {
      return Response.json(
        { locale, returnId, returnDetail: null, error: t(locale, "errors.generic"), guestToken } as LoaderData,
        { status: 500 },
      );
    }

    const returnDetail = (await statusRes.json()) as ReturnDetail;

    return Response.json({ locale, returnId, returnDetail, error: null, guestToken } as LoaderData);
  } catch {
    return Response.json(
      { locale, returnId, returnDetail: null, error: t(locale, "errors.generic"), guestToken } as LoaderData,
      { status: 500 },
    );
  }
}

export default function StatusPage() {
  const data = useLoaderData<LoaderData>();
  const locale = data.locale ?? "nl";

  return (
    <div className="rp-portal">
      <a href="#main-content" className="rp-portal__skip-link">
        {t(locale, "portal.skipToContent")}
      </a>

      <main id="main-content" className="rp-portal__container">
        <nav aria-label="Breadcrumb" style={{ marginBottom: "var(--space-5)" }}>
          <a
            href="/apps/returns"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              color: "var(--color-slate)",
              textDecoration: "none",
            }}
          >
            &larr; {t(locale, "portal.title")}
          </a>
        </nav>

        <header className="rp-page-header">
          <h1 className="rp-page-header__title">{t(locale, "status.title")}</h1>
          <p className="rp-page-header__subtitle">{t(locale, "status.subtitle")}</p>
        </header>

        {data.error ? (
          <div
            className="rp-alert rp-alert--warning"
            role="alert"
          >
            <span className="rp-alert__icon" aria-hidden="true">!</span>
            <span>{data.error}</span>
          </div>
        ) : data.returnDetail ? (
          <>
            {/* Retour-ID */}
            <div
              style={{
                marginBottom: "var(--space-5)",
                padding: "var(--space-4) var(--space-5)",
                background: "var(--color-warm-grey)",
                border: "1px solid var(--color-mid-grey)",
              }}
            >
              <p
                style={{ margin: 0, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-slate)" }}
              >
                {t(locale, "status.returnIdLabel")}
              </p>
              <p
                style={{ margin: "var(--space-1) 0 0", fontFamily: "var(--font-display)", fontSize: "18px", color: "var(--color-onyx)" }}
              >
                {data.returnId.slice(0, 8).toUpperCase()}
              </p>
            </div>

            {/* Huidige status */}
            <div
              style={{
                marginBottom: "var(--space-5)",
                padding: "var(--space-4) var(--space-5)",
                background: "var(--color-warm-grey)",
                border: "1px solid var(--color-mid-grey)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: "13px", color: "var(--color-slate)" }}>
                {t(locale, "status.currentStateLabel")}
              </span>
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--color-camel)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
                aria-label={`${t(locale, "status.currentStateLabel")}: ${t(locale, `status.states.${data.returnDetail.state}`)}`}
              >
                {t(locale, `status.states.${data.returnDetail.state}`)}
              </span>
            </div>

            {/* Terugbetalingsbedrag */}
            {data.returnDetail.totalRefundAmount && (
              <div
                style={{
                  marginBottom: "var(--space-5)",
                  padding: "var(--space-4) var(--space-5)",
                  background: "var(--color-warm-grey)",
                  border: "1px solid var(--color-mid-grey)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: "13px", color: "var(--color-slate)" }}>
                  {t(locale, "confirm.refundHeader")}
                </span>
                <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-onyx)" }}>
                  {formatPrice(
                    data.returnDetail.totalRefundAmount,
                    data.returnDetail.totalRefundCurrency,
                  )}
                </span>
              </div>
            )}

            {/* DHL tracking */}
            {data.returnDetail.dhlTrackingNumber && (
              <div
                className="rp-alert rp-alert--info"
                style={{ marginBottom: "var(--space-5)" }}
              >
                <span className="rp-alert__icon" aria-hidden="true">&#9432;</span>
                <span>
                  {locale === "nl" ? "Trackingnummer" : "Tracking number"}:{" "}
                  <strong>{data.returnDetail.dhlTrackingNumber}</strong>
                </span>
              </div>
            )}

            {/* Tijdlijn */}
            {data.returnDetail.history.length > 0 && (
              <Timeline
                history={data.returnDetail.history}
                currentState={data.returnDetail.state}
                locale={locale}
              />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}

/**
 * GET /apps/returns/confirm/:returnId — Stap 5: Bevestigingspagina
 *
 * Samenvatting van:
 * - Te retourneren artikelen
 * - Gekozen afhandeling
 * - Gekozen verzendmethode
 * - Terugbetalingsbedrag (via status-API)
 *
 * Checkbox: akkoord met retourvoorwaarden (verplicht).
 * Actie: POST /apps/returns/submit → redirect naar /success.
 */

import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import "~/styles/returns-portal.css";
import { detectLocale, t } from "~/i18n";
import type { Locale } from "~/i18n";
import { StepProgress } from "~/components/returns/StepProgress";
import { RefundSummary } from "~/components/returns/RefundSummary";
import { Button } from "~/components/returns/Button";
import type { Resolution, ReturnMethod, ReasonCode, ReturnItem } from "~/components/returns/types";

export const meta: MetaFunction = () => [
  { title: "Bevestigen — JANICE Retourportal" },
];

interface StatusData {
  id: string;
  state: string;
  resolution: Resolution | null;
  totalRefundAmount: string | null;
  totalRefundCurrency: string;
  items: ReturnItem[];
}

interface LoaderData {
  locale: Locale;
  returnId: string;
  guestToken: string | null;
  statusData: StatusData | null;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const locale = detectLocale(request);
  const url = new URL(request.url);
  const guestToken = url.searchParams.get("token");
  const returnId = params["returnId"] ?? "";

  let statusData: StatusData | null = null;

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
      statusData = (await statusRes.json()) as StatusData;
    }
  } catch {
    // Status ophalen mislukt — toon lege samenvatting
  }

  return Response.json({ locale, returnId, guestToken, statusData } as LoaderData);
}

export default function ConfirmStep() {
  const data = useLoaderData<LoaderData>();
  const locale = data.locale ?? "nl";
  const navigate = useNavigate();

  const [resolution, setResolution] = useState<Resolution | null>(data.statusData?.resolution ?? null);
  const [method, setMethod] = useState<ReturnMethod>("qr");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [termsError, setTermsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reasonCodes, setReasonCodes] = useState<Array<{ id: string; reasonCode: ReasonCode; subnote: string }>>([]);

  // Laad opgeslagen stap-data uit sessionStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedResolution = sessionStorage.getItem(`return_resolution_${data.returnId}`);
      if (storedResolution) {
        setResolution(storedResolution as Resolution);
      }

      const storedMethod = sessionStorage.getItem(`return_method_${data.returnId}`);
      if (storedMethod) {
        setMethod(storedMethod as ReturnMethod);
      }

      const storedReasons = sessionStorage.getItem(`return_reasons_${data.returnId}`);
      if (storedReasons) {
        const parsed = JSON.parse(storedReasons) as Array<{ id: string; reasonCode: ReasonCode; subnote: string }>;
        setReasonCodes(parsed);
      }
    }
  }, [data.returnId]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setTermsError(false);

    if (!agreedToTerms) {
      setTermsError(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        returnId: data.returnId,
        resolution: resolution ?? "refund",
        shippingMethod: method,
        lineItems: (data.statusData?.items ?? []).map((item) => {
          const reasonEntry = reasonCodes.find((r) => r.id === item.id);
          return {
            shopifyLineItemId: item.shopifyLineItemId,
            quantity: item.quantity,
            reasonCode: reasonEntry?.reasonCode ?? "CHANGED_MIND",
            reasonSubnote: reasonEntry?.subnote ?? undefined,
          };
        }),
        idempotencyKey: crypto.randomUUID(),
      };

      if (data.guestToken) {
        delete body.returnId;
        body.guestToken = data.guestToken;
      }

      const res = await fetch("/apps/returns/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = (await res.json()) as { error?: { message?: string } };
        setSubmitError(errData.error?.message ?? t(locale, "errors.generic"));
        setIsSubmitting(false);
        return;
      }

      // Verwijder sessiedata na succesvolle indiening
      sessionStorage.removeItem(`return_items_${data.returnId}`);
      sessionStorage.removeItem(`return_reasons_${data.returnId}`);
      sessionStorage.removeItem(`return_resolution_${data.returnId}`);
      sessionStorage.removeItem(`return_method_${data.returnId}`);
      if (data.guestToken) {
        sessionStorage.removeItem("janice_guest_token");
      }

      const successUrl = data.guestToken
        ? `/apps/returns/success/${data.returnId}?token=${encodeURIComponent(data.guestToken)}`
        : `/apps/returns/success/${data.returnId}`;

      navigate(successUrl);
    } catch {
      setSubmitError(t(locale, "errors.generic"));
      setIsSubmitting(false);
    }
  }

  const items = data.statusData?.items ?? [];
  const totalRefundAmount = data.statusData?.totalRefundAmount ?? "0.00";
  const currency = data.statusData?.totalRefundCurrency ?? "EUR";

  const resolutionLabel = resolution
    ? t(locale, `resolution.${resolution}.title`)
    : "";

  const methodLabel = method === "qr"
    ? t(locale, "method.qr.title")
    : t(locale, "method.label.title");

  return (
    <div className="rp-portal">
      <a href="#main-content" className="rp-portal__skip-link">
        {t(locale, "portal.skipToContent")}
      </a>

      <main id="main-content" className="rp-portal__container">
        <StepProgress currentStep={5} locale={locale} />

        <header className="rp-page-header">
          <h1 className="rp-page-header__title">{t(locale, "confirm.title")}</h1>
          <p className="rp-page-header__subtitle">{t(locale, "confirm.subtitle")}</p>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          {submitError && (
            <div
              className="rp-alert rp-alert--warning"
              role="alert"
              aria-live="assertive"
            >
              <span className="rp-alert__icon" aria-hidden="true">!</span>
              <span>{submitError}</span>
            </div>
          )}

          {/* Artikeloverzicht */}
          <div className="rp-summary-block" style={{ marginBottom: "var(--space-4)" }}>
            <div className="rp-summary-block__header">{t(locale, "confirm.itemsHeader")}</div>
            <div className="rp-summary-block__body">
              {items.length === 0 ? (
                <p style={{ color: "var(--color-slate)", fontSize: "14px", margin: 0 }}>
                  {locale === "nl" ? "Geen artikelen" : "No items"}
                </p>
              ) : (
                items.map((item) => {
                  const reasonEntry = reasonCodes.find((r) => r.id === item.id);
                  return (
                    <div key={item.id} className="rp-summary-block__row">
                      <span className="rp-summary-block__key">
                        {item.productTitle}
                        {item.variantTitle && ` (${item.variantTitle})`}
                        {" x"}{item.quantity}
                      </span>
                      <span className="rp-summary-block__value">
                        {reasonEntry
                          ? t(locale, `reason.codes.${reasonEntry.reasonCode}`)
                          : ""}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Afhandeling */}
          <div className="rp-summary-block" style={{ marginBottom: "var(--space-4)" }}>
            <div className="rp-summary-block__header">{t(locale, "confirm.resolutionHeader")}</div>
            <div className="rp-summary-block__body">
              <p style={{ margin: 0, fontSize: "14px", color: "var(--color-onyx)" }}>
                {resolutionLabel}
              </p>
            </div>
          </div>

          {/* Verzendmethode */}
          <div className="rp-summary-block" style={{ marginBottom: "var(--space-5)" }}>
            <div className="rp-summary-block__header">{t(locale, "confirm.methodHeader")}</div>
            <div className="rp-summary-block__body">
              <p style={{ margin: 0, fontSize: "14px", color: "var(--color-onyx)" }}>
                {methodLabel}
              </p>
            </div>
          </div>

          {/* Terugbetalingssamenvatting */}
          {items.length > 0 && (
            <RefundSummary
              items={items}
              totalRefundAmount={totalRefundAmount}
              totalRefundCurrency={currency}
              resolution={resolution}
              locale={locale}
            />
          )}

          {/* Akkoord retourvoorwaarden */}
          <div className="rp-confirm__terms">
            <input
              type="checkbox"
              id="terms-agreement"
              className="rp-confirm__terms-checkbox"
              checked={agreedToTerms}
              onChange={(e) => {
                setAgreedToTerms(e.target.checked);
                setTermsError(false);
              }}
              aria-required="true"
              aria-describedby={termsError ? "terms-error" : undefined}
            />
            <label
              htmlFor="terms-agreement"
              className="rp-confirm__terms-label"
            >
              {t(locale, "confirm.termsLabel")}{" "}
              <a
                href="/policies/return-policy"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t(locale, "confirm.termsLink")}
              </a>
            </label>
          </div>

          {termsError && (
            <div
              id="terms-error"
              className="rp-alert rp-alert--warning"
              role="alert"
              aria-live="polite"
              style={{ marginBottom: "var(--space-5)" }}
            >
              <span className="rp-alert__icon" aria-hidden="true">!</span>
              <span>{t(locale, "confirm.termsRequiredError")}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <a
              href={
                data.guestToken
                  ? `/apps/returns/method/${data.returnId}?token=${encodeURIComponent(data.guestToken)}`
                  : `/apps/returns/method/${data.returnId}`
              }
              className="rp-btn rp-btn--secondary rp-btn--full-width-mobile"
            >
              {t(locale, "confirm.backButton")}
            </a>
            <Button
              type="submit"
              variant="primary"
              style={{ flex: 1 }}
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting
                ? (locale === "nl" ? "Bezig met indienen..." : "Submitting...")
                : t(locale, "confirm.submitButton")}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

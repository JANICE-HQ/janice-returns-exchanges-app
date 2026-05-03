/**
 * GET /apps/returns/resolution/:returnId — Stap 3: Afhandeling kiezen
 *
 * Toont 3 kaarten: refund / exchange / store_credit.
 * Beschikbare opties worden bepaald op basis van redencodes (getAutoRouting).
 * Ops-review melding indien vereist.
 */

import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import "~/styles/returns-portal.css";
import { detectLocale, t } from "~/i18n";
import type { Locale } from "~/i18n";
import { StepProgress } from "~/components/returns/StepProgress";
import { ResolutionCards } from "~/components/returns/ResolutionCard";
import { Button } from "~/components/returns/Button";
import type { Resolution, ReasonCode } from "~/components/returns/types";

export const meta: MetaFunction = () => [
  { title: "Afhandeling kiezen — JANICE Retourportal" },
];

interface LoaderData {
  locale: Locale;
  returnId: string;
  guestToken: string | null;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const locale = detectLocale(request);
  const url = new URL(request.url);
  const guestToken = url.searchParams.get("token");
  const returnId = params["returnId"] ?? "";

  return Response.json({ locale, returnId, guestToken } as LoaderData);
}

/** Routing-regels gespiegeld vanuit services/reason-codes.ts (read-only referentie) */
function getAllowedResolutions(reasonCodes: ReasonCode[]): {
  allowed: Resolution[];
  requiresOpsReview: boolean;
  defaultResolution: Resolution;
} {
  // Als er meerdere codes zijn, neem de meest restrictieve
  let requiresOpsReview = false;
  let defaultResolution: Resolution = "refund";
  let canOverride = true;
  const allowedSet = new Set<Resolution>(["refund", "exchange", "store_credit"]);

  for (const code of reasonCodes) {
    switch (code) {
      case "TOO_BIG":
        defaultResolution = "exchange";
        break;
      case "TOO_SMALL":
        defaultResolution = "exchange";
        break;
      case "COLOR_DIFFERENT":
        canOverride = false;
        allowedSet.delete("exchange");
        allowedSet.delete("store_credit");
        break;
      case "DAMAGED":
        requiresOpsReview = true;
        canOverride = false;
        break;
      case "LATE_DELIVERY":
        requiresOpsReview = true;
        canOverride = false;
        break;
      case "WRONG_ITEM":
        requiresOpsReview = true;
        canOverride = false;
        break;
      case "NOT_AS_DESCRIBED":
        requiresOpsReview = true;
        canOverride = false;
        break;
      case "CHANGED_MIND":
        // Klant mag alles kiezen
        break;
    }
  }

  if (!canOverride) {
    allowedSet.clear();
    allowedSet.add("refund");
  }

  return {
    allowed: Array.from(allowedSet) as Resolution[],
    requiresOpsReview,
    defaultResolution,
  };
}

export default function ResolutionStep() {
  const data = useLoaderData<LoaderData>();
  const locale = data.locale ?? "nl";
  const navigate = useNavigate();

  const [selectedResolution, setSelectedResolution] = useState<Resolution | null>(null);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Laad redencodes uit sessionStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem(`return_reasons_${data.returnId}`);
      if (stored) {
        const parsed = JSON.parse(stored) as Array<{ reasonCode: ReasonCode }>;
        const codes = parsed.map((r) => r.reasonCode);
        setReasonCodes(codes);
      }
    }
  }, [data.returnId]);

  const { allowed, requiresOpsReview, defaultResolution } = getAllowedResolutions(reasonCodes);

  // Stel standaard resolutie in
  useEffect(() => {
    if (!selectedResolution && defaultResolution) {
      setSelectedResolution(defaultResolution);
    }
  }, [defaultResolution, selectedResolution]);

  function handleContinue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    if (!selectedResolution) {
      setFormError(locale === "nl" ? "Kies een afhandeling om door te gaan." : "Please choose a resolution to continue.");
      return;
    }

    // Sla resolutie op in sessionStorage
    sessionStorage.setItem(`return_resolution_${data.returnId}`, selectedResolution);

    const nextUrl = data.guestToken
      ? `/apps/returns/method/${data.returnId}?token=${encodeURIComponent(data.guestToken)}`
      : `/apps/returns/method/${data.returnId}`;

    navigate(nextUrl);
  }

  return (
    <div className="rp-portal">
      <a href="#main-content" className="rp-portal__skip-link">
        {t(locale, "portal.skipToContent")}
      </a>

      <main id="main-content" className="rp-portal__container">
        <StepProgress currentStep={3} locale={locale} />

        <header className="rp-page-header">
          <h1 className="rp-page-header__title">{t(locale, "resolution.title")}</h1>
          <p className="rp-page-header__subtitle">{t(locale, "resolution.subtitle")}</p>
        </header>

        {requiresOpsReview && (
          <div className="rp-ops-notice" role="status">
            <p className="rp-ops-notice__title">{t(locale, "resolution.opsReviewTitle")}</p>
            <p className="rp-ops-notice__text">{t(locale, "resolution.opsReviewText")}</p>
          </div>
        )}

        <form onSubmit={handleContinue} noValidate>
          {formError && (
            <div
              className="rp-alert rp-alert--warning"
              role="alert"
              aria-live="assertive"
            >
              <span className="rp-alert__icon" aria-hidden="true">!</span>
              <span>{formError}</span>
            </div>
          )}

          <ResolutionCards
            selected={selectedResolution}
            allowedResolutions={allowed}
            onChange={setSelectedResolution}
            locale={locale}
          />

          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <a
              href={
                data.guestToken
                  ? `/apps/returns/reason/${data.returnId}?token=${encodeURIComponent(data.guestToken)}`
                  : `/apps/returns/reason/${data.returnId}`
              }
              className="rp-btn rp-btn--secondary rp-btn--full-width-mobile"
            >
              {t(locale, "confirm.backButton")}
            </a>
            <Button
              type="submit"
              variant="primary"
              style={{ flex: 1 }}
            >
              {t(locale, "resolution.continueButton")}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

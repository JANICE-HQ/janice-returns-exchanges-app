/**
 * GET /apps/returns/method/:returnId — Stap 4: Verzendmethode kiezen
 *
 * Twee opties: QR-code (aanbevolen, standaard geselecteerd) of printlabel.
 * Binary keuze — geen Rule of 5/7 van toepassing op binaire keuze.
 */

import { useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import "~/styles/returns-portal.css";
import { detectLocale, t } from "~/i18n";
import type { Locale } from "~/i18n";
import { StepProgress } from "~/components/returns/StepProgress";
import { MethodCards } from "~/components/returns/MethodCard";
import { Button } from "~/components/returns/Button";
import type { ReturnMethod } from "~/components/returns/types";

export const meta: MetaFunction = () => [
  { title: "Verzendmethode — JANICE Retourportal" },
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

export default function MethodStep() {
  const data = useLoaderData<LoaderData>();
  const locale = data.locale ?? "nl";
  const navigate = useNavigate();

  // QR-code is de standaard (aanbevolen) keuze
  const [selectedMethod, setSelectedMethod] = useState<ReturnMethod>("qr");

  function handleContinue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Sla methode op in sessionStorage
    sessionStorage.setItem(`return_method_${data.returnId}`, selectedMethod);

    const nextUrl = data.guestToken
      ? `/apps/returns/confirm/${data.returnId}?token=${encodeURIComponent(data.guestToken)}`
      : `/apps/returns/confirm/${data.returnId}`;

    navigate(nextUrl);
  }

  return (
    <div className="rp-portal">
      <a href="#main-content" className="rp-portal__skip-link">
        {t(locale, "portal.skipToContent")}
      </a>

      <main id="main-content" className="rp-portal__container">
        <StepProgress currentStep={4} locale={locale} />

        <header className="rp-page-header">
          <h1 className="rp-page-header__title">{t(locale, "method.title")}</h1>
          <p className="rp-page-header__subtitle">{t(locale, "method.subtitle")}</p>
        </header>

        <form onSubmit={handleContinue} noValidate>
          <MethodCards
            selected={selectedMethod}
            onChange={setSelectedMethod}
            locale={locale}
          />

          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <a
              href={
                data.guestToken
                  ? `/apps/returns/resolution/${data.returnId}?token=${encodeURIComponent(data.guestToken)}`
                  : `/apps/returns/resolution/${data.returnId}`
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
              {t(locale, "method.continueButton")}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

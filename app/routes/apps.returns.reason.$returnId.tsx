/**
 * GET /apps/returns/reason/:returnId — Stap 2: Reden per artikel
 *
 * Toont per geselecteerd artikel een ReasonPicker met 8 redencodes.
 * Optioneel toelichting textarea (max 500 tekens).
 * Opslaan in sessionStorage voor de volgende stap (geen extra API call nodig).
 */

import { useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import "~/styles/returns-portal.css";
import { detectLocale, t } from "~/i18n";
import type { Locale } from "~/i18n";
import { StepProgress } from "~/components/returns/StepProgress";
import { ReasonPicker } from "~/components/returns/ReasonPicker";
import { Button } from "~/components/returns/Button";
import type { ReasonCode } from "~/components/returns/types";

export const meta: MetaFunction = () => [
  { title: "Reden opgeven — JANICE Retourportal" },
];

interface SelectedItem {
  id: string;
  qty: number;
  productTitle: string;
  variantTitle?: string | null;
}

interface LoaderData {
  locale: Locale;
  returnId: string;
  guestToken: string | null;
  items: SelectedItem[];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const locale = detectLocale(request);
  const url = new URL(request.url);
  const guestToken = url.searchParams.get("token");
  const returnId = params["returnId"] ?? "";

  if (!returnId) {
    return Response.json(
      { locale, returnId: "", guestToken, items: [] } as LoaderData,
      { status: 400 },
    );
  }

  // Haal retouritems op uit het status-eindpunt
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

    if (!statusRes.ok) {
      return Response.json({ locale, returnId, guestToken, items: [] } as LoaderData);
    }

    const statusData = (await statusRes.json()) as {
      items?: Array<{
        id: string;
        productTitle: string;
        variantTitle: string | null;
        quantity: number;
      }>;
    };

    const items: SelectedItem[] = (statusData.items ?? []).map((item) => ({
      id: item.id,
      qty: item.quantity,
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
    }));

    return Response.json({ locale, returnId, guestToken, items } as LoaderData);
  } catch {
    return Response.json({ locale, returnId, guestToken, items: [] } as LoaderData);
  }
}

export default function ReasonStep() {
  const data = useLoaderData<LoaderData>();
  const locale = data.locale ?? "nl";
  const navigate = useNavigate();

  const [reasons, setReasons] = useState<Record<string, ReasonCode | null>>({});
  const [subnotes, setSubnotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function handleReasonChange(itemId: string, reason: ReasonCode) {
    setReasons((prev) => ({ ...prev, [itemId]: reason }));
    setErrors((prev) => ({ ...prev, [itemId]: null }));
  }

  function handleSubnoteChange(itemId: string, note: string) {
    setSubnotes((prev) => ({ ...prev, [itemId]: note }));
  }

  function handleContinue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    // Valideer: elke item moet een reden hebben
    const newErrors: Record<string, string | null> = {};
    let hasErrors = false;

    for (const item of data.items) {
      if (!reasons[item.id]) {
        newErrors[item.id] = t(locale, "reason.selectReasonError");
        hasErrors = true;
      }
    }

    setErrors(newErrors);

    if (hasErrors) {
      setFormError(locale === "nl" ? "Geef voor elk artikel een reden op." : "Please provide a reason for each item.");
      return;
    }

    // Sla redenen op in sessionStorage voor stap 3
    const reasonData = data.items.map((item) => ({
      id: item.id,
      reasonCode: reasons[item.id] as ReasonCode,
      subnote: subnotes[item.id] ?? "",
    }));

    sessionStorage.setItem(`return_reasons_${data.returnId}`, JSON.stringify(reasonData));

    const nextUrl = data.guestToken
      ? `/apps/returns/resolution/${data.returnId}?token=${encodeURIComponent(data.guestToken)}`
      : `/apps/returns/resolution/${data.returnId}`;

    navigate(nextUrl);
  }

  return (
    <div className="rp-portal">
      <a href="#main-content" className="rp-portal__skip-link">
        {t(locale, "portal.skipToContent")}
      </a>

      <main id="main-content" className="rp-portal__container">
        <StepProgress currentStep={2} locale={locale} />

        <header className="rp-page-header">
          <h1 className="rp-page-header__title">{t(locale, "reason.title")}</h1>
          <p className="rp-page-header__subtitle">{t(locale, "reason.subtitle")}</p>
        </header>

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

          {data.items.length === 0 ? (
            <p style={{ color: "var(--color-slate)", fontSize: "14px" }}>
              {locale === "nl" ? "Geen artikelen gevonden." : "No items found."}
            </p>
          ) : (
            data.items.map((item) => (
              <ReasonPicker
                key={item.id}
                itemId={item.id}
                productTitle={item.productTitle}
                variantTitle={item.variantTitle}
                selectedReason={reasons[item.id] ?? null}
                subnote={subnotes[item.id] ?? ""}
                onReasonChange={handleReasonChange}
                onSubnoteChange={handleSubnoteChange}
                error={errors[item.id] ?? null}
                locale={locale}
              />
            ))
          )}

          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <a
              href={
                data.guestToken
                  ? `/apps/returns/start?token=${encodeURIComponent(data.guestToken)}`
                  : "/apps/returns"
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
              {t(locale, "reason.continueButton")}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

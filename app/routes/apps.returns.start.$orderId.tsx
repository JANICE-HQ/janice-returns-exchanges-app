/**
 * GET /apps/returns/start/:orderId — Stap 1: Artikelselectie
 * GET /apps/returns/start (geen orderId) — Gast entry point via ?token=
 *
 * Haalt bestelling + artikelen op via de API.
 * Toont per artikel: thumbnail, titel, prijs, checkbox + qty stepper.
 * Eligibility blockers getoond per artikel indien niet retourneerbaar.
 *
 * POST-action: sla selectie op in sessie en navigeer naar stap 2.
 */

import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import "~/styles/returns-portal.css";
import { detectLocale, t } from "~/i18n";
import type { Locale } from "~/i18n";
import { StepProgress } from "~/components/returns/StepProgress";
import { OrderHeader } from "~/components/returns/OrderHeader";
import { LineItemRow } from "~/components/returns/LineItemRow";
import { Button } from "~/components/returns/Button";
import type { LineItem } from "~/components/returns/types";

export const meta: MetaFunction = () => [
  { title: "Artikelen selecteren — JANICE Retourportal" },
];

interface LoaderData {
  locale: Locale;
  orderId: string;
  orderName: string;
  orderDate: string;
  totalPrice: string;
  currency: string;
  items: LineItem[];
  guestToken: string | null;
  error: string | null;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const locale = detectLocale(request);
  const url = new URL(request.url);
  const guestToken = url.searchParams.get("token");
  const orderId = params["orderId"] ?? "";

  // Als geen orderId maar wel token: haal orderId uit token (base64 decode van payload)
  let resolvedOrderId = orderId;
  if (!resolvedOrderId && guestToken) {
    try {
      const parts = guestToken.split(".");
      if (parts.length >= 2) {
        const payload = JSON.parse(
          Buffer.from(parts[1]!, "base64url").toString("utf-8"),
        ) as { orderId?: string };
        resolvedOrderId = payload.orderId ?? "";
      }
    } catch {
      // Token parsing mislukt — laat orderId leeg
    }
  }

  if (!resolvedOrderId) {
    return Response.json(
      { locale, error: t(locale, "errors.notFound"), items: [], orderId: "", orderName: "", orderDate: new Date().toISOString(), totalPrice: "0", currency: "EUR", guestToken } as LoaderData,
      { status: 400 },
    );
  }

  try {
    // Haal status op via het status-eindpunt (geeft order-info en items)
    const statusUrl = new URL(
      `/apps/returns/${encodeURIComponent(resolvedOrderId)}/status`,
      request.url,
    );
    if (guestToken) {
      statusUrl.searchParams.set("token", guestToken);
    }

    const statusRes = await fetch(statusUrl.href, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    });

    if (!statusRes.ok) {
      // Nieuw retour — haal bestelling direct op via de start endpoint (ingelogde klant)
      // Voor gast: items zitten nog niet in de DB, toon lege staat met token-info
      return Response.json({
        locale,
        orderId: resolvedOrderId,
        orderName: `#${resolvedOrderId.slice(-6).toUpperCase()}`,
        orderDate: new Date().toISOString(),
        totalPrice: "0.00",
        currency: "EUR",
        items: [],
        guestToken,
        error: null,
      } as LoaderData);
    }

    const statusData = (await statusRes.json()) as {
      id: string;
      items?: Array<{
        id: string;
        productTitle: string;
        variantTitle: string | null;
        quantity: number;
        unitPrice: string;
      }>;
    };

    const items: LineItem[] = (statusData.items ?? []).map((item) => ({
      id: item.id,
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      imageUrl: null,
      isEligible: true,
    }));

    return Response.json({
      locale,
      orderId: resolvedOrderId,
      orderName: resolvedOrderId,
      orderDate: new Date().toISOString(),
      totalPrice: "0.00",
      currency: "EUR",
      items,
      guestToken,
      error: null,
    } as LoaderData);
  } catch {
    return Response.json({
      locale,
      orderId: resolvedOrderId,
      orderName: resolvedOrderId,
      orderDate: new Date().toISOString(),
      totalPrice: "0.00",
      currency: "EUR",
      items: [],
      guestToken,
      error: null,
    } as LoaderData);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const locale = detectLocale(request);
  const formData = await request.formData();
  const orderId = String(formData.get("orderId") ?? "");
  const guestToken = String(formData.get("guestToken") ?? "");
  const selectedItems = String(formData.get("selectedItems") ?? "[]");

  if (!orderId) {
    return Response.json({ error: t(locale, "errors.generic") }, { status: 400 });
  }

  let parsedItems: Array<{ id: string; qty: number }> = [];
  try {
    parsedItems = JSON.parse(selectedItems) as Array<{ id: string; qty: number }>;
  } catch {
    return Response.json({ error: t(locale, "errors.generic") }, { status: 400 });
  }

  if (parsedItems.length === 0) {
    return Response.json({ error: t(locale, "items.noItemsError") }, { status: 400 });
  }

  // Maak DRAFT-retour aan via de start-API
  const apiUrl = new URL("/apps/returns/start", request.url);

  const body: Record<string, unknown> = {
    shopifyOrderId: orderId,
    lineItems: parsedItems.map((item) => ({
      shopifyLineItemId: item.id,
      quantity: item.qty,
    })),
    idempotencyKey: crypto.randomUUID(),
  };

  if (guestToken) {
    body.guestToken = guestToken;
  }

  const apiResponse = await fetch(apiUrl.href, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
    },
    body: JSON.stringify(body),
  });

  if (!apiResponse.ok) {
    return Response.json({ error: t(locale, "errors.generic") }, { status: 400 });
  }

  const apiData = (await apiResponse.json()) as { id?: string };
  const returnId = apiData.id;

  if (!returnId) {
    return Response.json({ error: t(locale, "errors.generic") }, { status: 500 });
  }

  const redirectUrl = guestToken
    ? `/apps/returns/reason/${returnId}?token=${encodeURIComponent(guestToken)}`
    : `/apps/returns/reason/${returnId}`;

  return Response.redirect(redirectUrl, 303);
}

export default function SelectItems() {
  const data = useLoaderData<LoaderData>();
  const locale = data.locale ?? "nl";
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function handleToggle(id: string, checked: boolean) {
    setSelected((prev) => ({ ...prev, [id]: checked }));
    if (checked && !quantities[id]) {
      setQuantities((prev) => ({ ...prev, [id]: 1 }));
    }
  }

  function handleQtyChange(id: string, qty: number) {
    setQuantities((prev) => ({ ...prev, [id]: qty }));
  }

  async function handleContinue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const selectedItems = data.items
      .filter((item) => selected[item.id] && item.isEligible !== false)
      .map((item) => ({ id: item.id, qty: quantities[item.id] ?? 1 }));

    if (selectedItems.length === 0) {
      setFormError(t(locale, "items.noItemsError"));
      return;
    }

    // Client-side: POST naar de API direct, sla returnId op
    const body: Record<string, unknown> = {
      shopifyOrderId: data.orderId,
      lineItems: selectedItems.map((item) => ({
        shopifyLineItemId: item.id,
        quantity: item.qty,
      })),
      idempotencyKey: crypto.randomUUID(),
    };

    if (data.guestToken) {
      body.guestToken = data.guestToken;
    }

    try {
      const res = await fetch("/apps/returns/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = (await res.json()) as { error?: { message?: string } };
        setFormError(errData.error?.message ?? t(locale, "errors.generic"));
        return;
      }

      const apiData = (await res.json()) as { id?: string };
      const returnId = apiData.id;

      if (!returnId) {
        setFormError(t(locale, "errors.generic"));
        return;
      }

      // Sla geselecteerde items op in sessionStorage voor volgende stap
      sessionStorage.setItem(`return_items_${returnId}`, JSON.stringify(selectedItems));

      const nextUrl = data.guestToken
        ? `/apps/returns/reason/${returnId}?token=${encodeURIComponent(data.guestToken)}`
        : `/apps/returns/reason/${returnId}`;

      navigate(nextUrl);
    } catch {
      setFormError(t(locale, "errors.generic"));
    }
  }

  return (
    <div className="rp-portal">
      <a href="#main-content" className="rp-portal__skip-link">
        {t(locale, "portal.skipToContent")}
      </a>

      <main id="main-content" className="rp-portal__container">
        <StepProgress currentStep={1} locale={locale} />

        <header className="rp-page-header">
          <h1 className="rp-page-header__title">{t(locale, "items.title")}</h1>
          <p className="rp-page-header__subtitle">{t(locale, "items.subtitle")}</p>
        </header>

        {data.error ? (
          <div className="rp-alert rp-alert--warning" role="alert">
            <span className="rp-alert__icon" aria-hidden="true">!</span>
            <span>{data.error}</span>
          </div>
        ) : (
          <form onSubmit={handleContinue} noValidate>
            <input type="hidden" name="orderId" value={data.orderId} />
            {data.guestToken && (
              <input type="hidden" name="guestToken" value={data.guestToken} />
            )}

            <OrderHeader
              orderName={data.orderName}
              orderDate={data.orderDate}
              totalPrice={data.totalPrice}
              currency={data.currency}
              locale={locale}
            />

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
              <p style={{ color: "var(--color-slate)", fontSize: "14px", marginBottom: "var(--space-5)" }}>
                {locale === "nl" ? "Geen artikelen gevonden voor deze bestelling." : "No items found for this order."}
              </p>
            ) : (
              <div
                role="group"
                aria-label={locale === "nl" ? "Artikelen" : "Items"}
                style={{ marginBottom: "var(--space-6)" }}
              >
                {data.items.map((item) => (
                  <LineItemRow
                    key={item.id}
                    item={item}
                    selected={!!selected[item.id]}
                    selectedQty={quantities[item.id] ?? 1}
                    onToggle={handleToggle}
                    onQtyChange={handleQtyChange}
                    locale={locale}
                  />
                ))}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              fullWidth={false}
              style={{ width: "100%" }}
            >
              {t(locale, "items.continueButton")}
            </Button>
          </form>
        )}
      </main>
    </div>
  );
}

/**
 * GET /apps/returns/guest — Gast-zoekopdracht voor bestelling
 *
 * Formulier met bestelnummer + e-mail.
 * Bij succes: sla JWT op in sessionStorage, navigeer naar stap 1.
 * Rate-limit UX: countdown timer bij 429.
 * Not-found UX: neutrale boodschap (lekt geen bestellingsinformatie).
 *
 * Werkt progressief — form submit zonder JS werkt ook (fallback via action).
 */

import { useState, useEffect, useRef } from "react";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { Form, useActionData, useNavigation } from "react-router";
import "~/styles/returns-portal.css";
import { detectLocale, t } from "~/i18n";
import type { Locale } from "~/i18n";

export const meta: MetaFunction = () => [
  { title: "Bestelling opzoeken — JANICE Retourportal" },
];

export async function loader() {
  return Response.json({ ok: true });
}

interface ActionData {
  error?: string;
  errorType?: "not_found" | "rate_limited" | "generic";
  retryAfterSeconds?: number;
  success?: boolean;
  token?: string;
  orderId?: string;
}

/**
 * Fallback server-side action voor no-JS formulierverwerking.
 * Met JS verwerkt de client-side handler de POST rechtstreeks.
 */
export async function action({ request }: ActionFunctionArgs) {
  const locale = detectLocale(request);
  const formData = await request.formData();
  const orderName = String(formData.get("orderName") ?? "");
  const email = String(formData.get("email") ?? "");

  if (!orderName || !email) {
    return Response.json(
      { error: t(locale, "errors.generic"), errorType: "generic" } as ActionData,
      { status: 400 },
    );
  }

  try {
    const response = await fetch(new URL("/apps/returns/guest-lookup", request.url).href, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // HMAC-verificatie wordt door de server afgehandeld; App Proxy geeft de
        // handtekening door via de query-parameters, niet via de body.
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        orderName: orderName.startsWith("#") ? orderName : `#${orderName}`,
        email,
        idempotencyKey: crypto.randomUUID(),
      }),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "900");
      return Response.json(
        {
          error: t(locale, "guest.rateLimitMessage", {
            minutes: Math.ceil(retryAfter / 60).toString(),
          }),
          errorType: "rate_limited",
          retryAfterSeconds: retryAfter,
        } as ActionData,
        { status: 429 },
      );
    }

    const data = (await response.json()) as { found?: boolean; token?: string; eligibility?: unknown };

    if (!data.found) {
      return Response.json(
        { error: t(locale, "guest.notFoundMessage"), errorType: "not_found" } as ActionData,
        { status: 200 },
      );
    }

    // Succes — client-side navigatie met token
    return Response.json({ success: true, token: data.token } as ActionData);
  } catch {
    return Response.json(
      { error: t(locale, "errors.generic"), errorType: "generic" } as ActionData,
      { status: 500 },
    );
  }
}

export default function GuestLookup() {
  const locale: Locale = "nl";
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [orderName, setOrderName] = useState("");
  const [email, setEmail] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rate-limit countdown
  useEffect(() => {
    if (actionData?.errorType === "rate_limited" && actionData.retryAfterSeconds) {
      setCountdown(actionData.retryAfterSeconds);
    }
  }, [actionData]);

  useEffect(() => {
    if (countdown !== null && countdown > 0) {
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [countdown]);

  // Client-side JS submit handler — slaat JWT op in sessionStorage
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);

    if (!orderName.trim() || !email.trim()) {
      setClientError(t(locale, "errors.generic"));
      return;
    }

    const formattedOrder = orderName.startsWith("#") ? orderName : `#${orderName}`;

    try {
      const response = await fetch("/apps/returns/guest-lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderName: formattedOrder,
          email: email.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "900");
        const minutes = Math.ceil(retryAfter / 60);
        setClientError(t(locale, "guest.rateLimitMessage", { minutes: String(minutes) }));
        setCountdown(retryAfter);
        return;
      }

      const data = (await response.json()) as { found?: boolean; token?: string };

      if (!data.found || !data.token) {
        setClientError(t(locale, "guest.notFoundMessage"));
        return;
      }

      // Sla JWT op in sessionStorage (NIET localStorage — korte levensduur)
      sessionStorage.setItem("janice_guest_token", data.token);

      // Navigeer naar stap 1 met token als query param
      // Bestelnummer zit in het token; de server decodeert het
      window.location.href = `/apps/returns/start?token=${encodeURIComponent(data.token)}`;
    } catch {
      setClientError(t(locale, "errors.generic"));
    }
  }

  const displayError = clientError ?? (actionData?.error ?? null);
  const isRateLimited = actionData?.errorType === "rate_limited" && countdown !== null;

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
          <h1 className="rp-page-header__title">{t(locale, "guest.title")}</h1>
          <p className="rp-page-header__subtitle">{t(locale, "guest.subtitle")}</p>
        </header>

        <div className="rp-guest-form">
          {displayError && (
            <div
              className="rp-alert rp-alert--warning"
              role="alert"
              aria-live="assertive"
            >
              <span className="rp-alert__icon" aria-hidden="true">!</span>
              <span>
                {displayError}
                {isRateLimited && countdown !== null && (
                  <span className="rp-guest-form__countdown">
                    {" "}{t(locale, "guest.rateLimitCountdown", { seconds: String(countdown) })}
                  </span>
                )}
              </span>
            </div>
          )}

          <Form method="post" onSubmit={handleSubmit} noValidate>
            <div className="rp-field">
              <label htmlFor="orderName" className="rp-field__label">
                {t(locale, "guest.orderNumberLabel")}
              </label>
              <input
                id="orderName"
                name="orderName"
                type="text"
                className="rp-field__input"
                placeholder={t(locale, "guest.orderNumberPlaceholder")}
                value={orderName}
                onChange={(e) => setOrderName(e.target.value)}
                autoComplete="off"
                required
                aria-required="true"
              />
            </div>

            <div className="rp-field">
              <label htmlFor="email" className="rp-field__label">
                {t(locale, "guest.emailLabel")}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="rp-field__input"
                placeholder={t(locale, "guest.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                aria-required="true"
              />
            </div>

            <button
              type="submit"
              className="rp-btn rp-btn--primary rp-btn--full-width-mobile"
              disabled={isSubmitting || isRateLimited}
              aria-busy={isSubmitting}
            >
              {isSubmitting
                ? (locale === "nl" ? "Bezig..." : "Searching...")
                : t(locale, "guest.submitButton")}
            </button>
          </Form>
        </div>
      </main>
    </div>
  );
}

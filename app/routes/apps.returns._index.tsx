/**
 * GET /apps/returns — Landingspagina van het retourportal
 *
 * Biedt twee paden:
 * 1. Ingelogde klant → /account/login op Shopify
 * 2. Gast → /apps/returns/guest (zoekopdracht op bestelling)
 *
 * Toont 5 vertrouwenssignalen (Rule of 5/7 compliant).
 * Server-rendered, werkt zonder JavaScript.
 */

import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import "~/styles/returns-portal.css";
import { detectLocale, t, tArray } from "~/i18n";
import type { Locale } from "~/i18n";
import { StepProgress } from "~/components/returns/StepProgress";
import { TrustSignals } from "~/components/returns/TrustSignals";

export const meta: MetaFunction = () => [
  { title: "Retourneren of ruilen — JANICE" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const locale = detectLocale(request);
  const url = new URL(request.url);
  const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");

  return Response.json({
    locale,
    loggedInCustomerId,
  });
}

interface LoaderData {
  locale: Locale;
  loggedInCustomerId: string | null;
}

export default function ReturnsLanding() {
  // Server-rendered: gebruik statische NL tekst als default.
  // Locale wordt via loader beschikbaar gesteld — voor SSR verwerking.
  const locale: Locale = "nl";

  const trustSignals = tArray(locale, "trust.signals");

  return (
    <div className="rp-portal">
      <a href="#main-content" className="rp-portal__skip-link">
        {t(locale, "portal.skipToContent")}
      </a>

      <main id="main-content" className="rp-portal__container">
        <div className="rp-landing">
          <header className="rp-page-header">
            <h1 className="rp-page-header__title">
              {t(locale, "portal.title")}
            </h1>
            <p className="rp-page-header__subtitle">
              {t(locale, "portal.subtitle")}
            </p>
          </header>

          <div className="rp-landing__cta-group">
            {/* Inloggen CTA — verwijst terug naar Shopify account */}
            <a
              href="/account/login?return_url=/apps/returns"
              className="rp-btn rp-btn--primary rp-btn--full-width-mobile"
            >
              {t(locale, "portal.loginCta")}
            </a>

            {/* Gast CTA */}
            <a
              href="/apps/returns/guest"
              className="rp-btn rp-btn--secondary rp-btn--full-width-mobile"
            >
              {t(locale, "portal.guestCta")}
            </a>
          </div>

          {/* Trust signals: 5 items (Rule of 5/7) */}
          <aside
            className="rp-trust-signals"
            aria-label={t(locale, "trust.title")}
            style={{ marginTop: "var(--space-7)" }}
          >
            <p className="rp-trust-signals__title">{t(locale, "trust.title")}</p>
            <ul className="rp-trust-signals__list">
              {trustSignals.map((signal, idx) => (
                <li key={idx} className="rp-trust-signals__item">
                  <span className="rp-trust-signals__icon" aria-hidden="true" />
                  <span>{signal}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </main>
    </div>
  );
}

/**
 * TrustSignals component — JANICE Returns Portal
 *
 * 5 vertrouwenspunten (Rule of 5/7 compliant).
 * Camel bullet iconen. Consistent met PDP trust block.
 */

import type { Locale } from "~/i18n";
import { t, tArray } from "~/i18n";

interface TrustSignalsProps {
  locale?: Locale;
}

export function TrustSignals({ locale = "nl" }: TrustSignalsProps) {
  const signals = tArray(locale, "trust.signals");

  return (
    <aside className="rp-trust-signals" aria-label={t(locale, "trust.title")}>
      <p className="rp-trust-signals__title">{t(locale, "trust.title")}</p>
      <ul className="rp-trust-signals__list">
        {signals.map((signal, idx) => (
          <li key={idx} className="rp-trust-signals__item">
            <span className="rp-trust-signals__icon" aria-hidden="true" />
            <span>{signal}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

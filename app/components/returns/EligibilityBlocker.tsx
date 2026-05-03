/**
 * EligibilityBlocker component — JANICE Returns Portal
 *
 * Toont inline per artikel waarom het niet retourneerbaar is.
 * role="alert" voor screen readers. Icon + tekst (nooit kleur alleen).
 */

import type { Locale } from "~/i18n";
import { t } from "~/i18n";

interface EligibilityBlockerProps {
  reasonKey: string;
  locale?: Locale;
}

/** Map van reden-sleutels naar i18n-sleutels */
const BLOCKER_KEY_MAP: Record<string, string> = {
  final_sale: "items.finalSaleBlocker",
  window_expired: "items.windowExpiredBlocker",
  already_returned: "items.alreadyReturnedBlocker",
};

export function EligibilityBlocker({ reasonKey, locale = "nl" }: EligibilityBlockerProps) {
  const i18nKey = BLOCKER_KEY_MAP[reasonKey] ?? "items.finalSaleBlocker";
  const message = t(locale, i18nKey);

  return (
    <div
      className="rp-eligibility-blocker"
      role="alert"
      aria-live="polite"
    >
      <span className="rp-eligibility-blocker__icon" aria-hidden="true">!</span>
      <p className="rp-eligibility-blocker__text">{message}</p>
    </div>
  );
}

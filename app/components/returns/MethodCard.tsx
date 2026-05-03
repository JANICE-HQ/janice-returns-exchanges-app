/**
 * MethodCard component — JANICE Returns Portal
 *
 * 2 retourmethoden: QR-code (aanbevolen) of printlabel.
 * Binary keuze — geen Rule of 5/7 overtreding (zie PR-documentatie).
 */

import { clsx } from "clsx";
import type { Locale } from "~/i18n";
import { t } from "~/i18n";
import type { ReturnMethod } from "./types";

interface MethodCardProps {
  value: ReturnMethod;
  selected: boolean;
  onChange: (value: ReturnMethod) => void;
  locale?: Locale;
}

export function MethodCard({
  value,
  selected,
  onChange,
  locale = "nl",
}: MethodCardProps) {
  const radioId = `method-${value}`;

  return (
    <label
      htmlFor={radioId}
      className={clsx(
        "rp-method-card",
        selected && "rp-method-card--selected",
      )}
    >
      <div className="rp-method-card__header">
        <input
          type="radio"
          id={radioId}
          name="returnMethod"
          value={value}
          checked={selected}
          onChange={() => onChange(value)}
          className="rp-method-card__radio"
        />
        <h3 className="rp-method-card__title">
          {t(locale, `method.${value}.title`)}
        </h3>
        {value === "qr" && (
          <span className="rp-method-card__badge" aria-label={t(locale, "method.qr.badge")}>
            {t(locale, "method.qr.badge")}
          </span>
        )}
      </div>
      <p className="rp-method-card__description">
        {t(locale, `method.${value}.description`)}
      </p>
    </label>
  );
}

interface MethodCardsProps {
  selected: ReturnMethod;
  onChange: (value: ReturnMethod) => void;
  locale?: Locale;
}

export function MethodCards({ selected, onChange, locale = "nl" }: MethodCardsProps) {
  return (
    <div
      className="rp-method-cards"
      role="radiogroup"
      aria-label={t(locale, "method.title")}
    >
      <MethodCard value="qr" selected={selected === "qr"} onChange={onChange} locale={locale} />
      <MethodCard value="label" selected={selected === "label"} onChange={onChange} locale={locale} />
    </div>
  );
}

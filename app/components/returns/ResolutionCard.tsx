/**
 * ResolutionCard component — JANICE Returns Portal
 *
 * 3 kaarten: refund / exchange / store_credit
 * Elk met radio button, titel, beschrijving en timeline.
 * Disabled indien de reden-routing het niet toestaat.
 */

import { clsx } from "clsx";
import type { Locale } from "~/i18n";
import { t } from "~/i18n";
import type { Resolution } from "./types";

interface ResolutionCardProps {
  value: Resolution;
  selected: boolean;
  disabled?: boolean;
  onChange: (value: Resolution) => void;
  locale?: Locale;
}

export function ResolutionCard({
  value,
  selected,
  disabled = false,
  onChange,
  locale = "nl",
}: ResolutionCardProps) {
  const radioId = `resolution-${value}`;

  return (
    <label
      htmlFor={radioId}
      className={clsx(
        "rp-resolution-card",
        selected && "rp-resolution-card--selected",
        disabled && "rp-resolution-card--disabled",
      )}
    >
      <div className="rp-resolution-card__header">
        <input
          type="radio"
          id={radioId}
          name="resolution"
          value={value}
          checked={selected}
          disabled={disabled}
          onChange={() => onChange(value)}
          className="rp-resolution-card__radio"
        />
        <h3 className="rp-resolution-card__title">
          {t(locale, `resolution.${value}.title`)}
        </h3>
        {value === "store_credit" && (
          <span className="rp-resolution-card__badge" aria-label={t(locale, "resolution.store_credit.badge")}>
            {t(locale, "resolution.store_credit.badge")}
          </span>
        )}
      </div>
      <p className="rp-resolution-card__description">
        {t(locale, `resolution.${value}.description`)}
      </p>
      <p className="rp-resolution-card__timeline">
        {t(locale, `resolution.${value}.timeline`)}
      </p>
    </label>
  );
}

interface ResolutionCardsProps {
  selected: Resolution | null;
  allowedResolutions: Resolution[];
  onChange: (value: Resolution) => void;
  locale?: Locale;
}

export function ResolutionCards({
  selected,
  allowedResolutions,
  onChange,
  locale = "nl",
}: ResolutionCardsProps) {
  const ALL_RESOLUTIONS: Resolution[] = ["refund", "exchange", "store_credit"];

  return (
    <div
      className="rp-resolution-cards"
      role="radiogroup"
      aria-label={t(locale, "resolution.title")}
    >
      {ALL_RESOLUTIONS.map((res) => (
        <ResolutionCard
          key={res}
          value={res}
          selected={selected === res}
          disabled={!allowedResolutions.includes(res)}
          onChange={onChange}
          locale={locale}
        />
      ))}
    </div>
  );
}

/**
 * ReasonPicker component — JANICE Returns Portal
 *
 * Per geselecteerd artikel: kies reden (8 codes) + optioneel textarea.
 * Volledig keyboard-navigeerbaar via radio buttons.
 * Max 500 tekens voor de toelichting.
 */

import { useState } from "react";
import { clsx } from "clsx";
import type { Locale } from "~/i18n";
import { t } from "~/i18n";
import type { ReasonCode } from "./types";

const REASON_CODES: ReasonCode[] = [
  "TOO_BIG",
  "TOO_SMALL",
  "COLOR_DIFFERENT",
  "DAMAGED",
  "LATE_DELIVERY",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "CHANGED_MIND",
];

interface ReasonPickerProps {
  itemId: string;
  productTitle: string;
  variantTitle?: string | null;
  selectedReason: ReasonCode | null;
  subnote: string;
  onReasonChange: (itemId: string, reason: ReasonCode) => void;
  onSubnoteChange: (itemId: string, note: string) => void;
  error?: string | null;
  locale?: Locale;
}

const MAX_NOTE_CHARS = 500;

export function ReasonPicker({
  itemId,
  productTitle,
  variantTitle,
  selectedReason,
  subnote,
  onReasonChange,
  onSubnoteChange,
  error,
  locale = "nl",
}: ReasonPickerProps) {
  const [isFocused, setIsFocused] = useState(false);
  const fieldGroupId = `reason-group-${itemId}`;
  const errorId = `reason-error-${itemId}`;
  const noteId = `reason-note-${itemId}`;

  return (
    <div className="rp-reason-picker">
      <p className="rp-reason-picker__item-label">
        {locale === "nl" ? "Artikel" : "Item"}
      </p>
      <p className="rp-reason-picker__item-name">
        {productTitle}
        {variantTitle && (
          <span style={{ color: "var(--color-slate)", marginLeft: "8px", fontWeight: 400 }}>
            — {variantTitle}
          </span>
        )}
      </p>

      <fieldset id={fieldGroupId} aria-describedby={error ? errorId : undefined}>
        <legend
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            color: "var(--color-onyx)",
            fontWeight: 500,
            marginBottom: "var(--space-3)",
            padding: 0,
          }}
        >
          {t(locale, "reason.title")}
        </legend>

        <div className="rp-reason-picker__options" role="radiogroup">
          {REASON_CODES.map((code) => {
            const radioId = `reason-${itemId}-${code}`;
            const isSelected = selectedReason === code;

            return (
              <label
                key={code}
                htmlFor={radioId}
                className={clsx(
                  "rp-reason-picker__option",
                  isSelected && "rp-reason-picker__option--selected",
                )}
              >
                <input
                  type="radio"
                  id={radioId}
                  name={`reason-${itemId}`}
                  value={code}
                  checked={isSelected}
                  onChange={() => onReasonChange(itemId, code)}
                  className="rp-reason-picker__radio"
                  aria-label={t(locale, `reason.codes.${code}`)}
                />
                <span className="rp-reason-picker__option-label">
                  {t(locale, `reason.codes.${code}`)}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {error && (
        <div
          id={errorId}
          className="rp-reason-picker__error"
          role="alert"
          aria-live="polite"
        >
          <span aria-hidden="true">&#9888;</span>
          <span>{error}</span>
        </div>
      )}

      {/* Optioneel toelichting textarea */}
      <div>
        <label
          htmlFor={noteId}
          className="rp-reason-picker__textarea-label"
        >
          {t(locale, "reason.noteLabel")}
        </label>
        <textarea
          id={noteId}
          className="rp-reason-picker__textarea"
          value={subnote}
          maxLength={MAX_NOTE_CHARS}
          placeholder={t(locale, "reason.notePlaceholder")}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={(e) => onSubnoteChange(itemId, e.target.value)}
          style={{
            borderColor: isFocused ? "var(--color-onyx)" : undefined,
          }}
          aria-label={t(locale, "reason.noteLabel")}
        />
        <p className="rp-reason-picker__char-count" aria-live="polite">
          {subnote.length} / {MAX_NOTE_CHARS}
        </p>
      </div>
    </div>
  );
}

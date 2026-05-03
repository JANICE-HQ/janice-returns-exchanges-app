/**
 * LineItemRow component — JANICE Returns Portal
 *
 * Toont een bestelregel met:
 * - Checkbox voor selectie
 * - Productafbeelding (4:5 ratio)
 * - Producttitel, varianttitel, prijs
 * - Qty stepper (1 tot gekochte hoeveelheid)
 * - Eligibility blocker indien niet retourneerbaar
 *
 * Volledig keyboard-navigeerbaar en toegankelijk.
 */

import { clsx } from "clsx";
import type { Locale } from "~/i18n";
import { t } from "~/i18n";
import { formatPrice } from "./types";
import { EligibilityBlocker } from "./EligibilityBlocker";

interface LineItemRowProps {
  item: {
    id: string;
    productTitle: string;
    variantTitle: string | null;
    quantity: number;
    unitPrice: string;
    imageUrl?: string | null;
    isEligible?: boolean;
    eligibilityBlockerKey?: string | null;
  };
  selected: boolean;
  selectedQty: number;
  onToggle: (id: string, selected: boolean) => void;
  onQtyChange: (id: string, qty: number) => void;
  locale?: Locale;
}

export function LineItemRow({
  item,
  selected,
  selectedQty,
  onToggle,
  onQtyChange,
  locale = "nl",
}: LineItemRowProps) {
  const isBlocked = item.isEligible === false;
  const checkboxId = `item-select-${item.id}`;
  const qtyDecId = `qty-dec-${item.id}`;
  const qtyIncId = `qty-inc-${item.id}`;
  const qtyDisplayId = `qty-val-${item.id}`;

  return (
    <div
      className={clsx(
        "rp-line-item",
        isBlocked && "rp-line-item--blocked",
      )}
    >
      {/* Checkbox + product info rij */}
      <div className="rp-line-item__checkbox-wrap">
        <input
          type="checkbox"
          id={checkboxId}
          className="rp-line-item__checkbox"
          checked={selected}
          disabled={isBlocked}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          aria-describedby={isBlocked ? `blocker-${item.id}` : undefined}
        />
        <label
          htmlFor={checkboxId}
          style={{ fontFamily: "var(--font-body)", fontSize: "15px", cursor: isBlocked ? "not-allowed" : "pointer" }}
        >
          {item.productTitle}
          {item.variantTitle && (
            <span style={{ color: "var(--color-slate)", marginLeft: "6px", fontSize: "13px" }}>
              — {item.variantTitle}
            </span>
          )}
        </label>
      </div>

      {/* Afbeelding */}
      <div className="rp-line-item__image-wrap">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.productTitle}
            className="rp-line-item__image"
            loading="lazy"
          />
        ) : (
          <div
            className="rp-line-item__image-placeholder"
            aria-hidden="true"
          >
            &#9744;
          </div>
        )}
      </div>

      {/* Details */}
      <div className="rp-line-item__details">
        <p className="rp-line-item__product-title" aria-hidden="true">
          {item.productTitle}
        </p>
        {item.variantTitle && (
          <p className="rp-line-item__variant-title">{item.variantTitle}</p>
        )}
        <p className="rp-line-item__price">
          {formatPrice(item.unitPrice)}
        </p>

        {/* Qty stepper — alleen zichtbaar als geselecteerd */}
        {selected && !isBlocked && (
          <div
            className="rp-line-item__qty-stepper"
            role="group"
            aria-label={`${t(locale, "items.qtyLabel")} ${item.productTitle}`}
          >
            <button
              id={qtyDecId}
              type="button"
              className="rp-line-item__qty-btn"
              onClick={() => onQtyChange(item.id, Math.max(1, selectedQty - 1))}
              disabled={selectedQty <= 1}
              aria-label={locale === "nl" ? "Minder" : "Decrease"}
              aria-controls={qtyDisplayId}
            >
              &minus;
            </button>
            <span
              id={qtyDisplayId}
              className="rp-line-item__qty-value"
              aria-live="polite"
              aria-atomic="true"
              aria-label={`${t(locale, "items.qtyLabel")}: ${selectedQty}`}
            >
              {selectedQty}
            </span>
            <button
              id={qtyIncId}
              type="button"
              className="rp-line-item__qty-btn"
              onClick={() => onQtyChange(item.id, Math.min(item.quantity, selectedQty + 1))}
              disabled={selectedQty >= item.quantity}
              aria-label={locale === "nl" ? "Meer" : "Increase"}
              aria-controls={qtyDisplayId}
            >
              +
            </button>
          </div>
        )}

        {/* Eligibility blocker */}
        {isBlocked && item.eligibilityBlockerKey && (
          <div id={`blocker-${item.id}`}>
            <EligibilityBlocker
              reasonKey={item.eligibilityBlockerKey}
              locale={locale}
            />
          </div>
        )}
      </div>
    </div>
  );
}

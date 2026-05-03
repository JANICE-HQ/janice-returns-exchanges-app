/**
 * RefundSummary component — JANICE Returns Portal
 *
 * Toont de berekende terugbetaling per artikel + totaal.
 * Bedragen altijd in "249,95 EUR" formaat (brand law).
 */

import type { Locale } from "~/i18n";
import { t } from "~/i18n";
import { formatPrice } from "./types";
import type { ReturnItem } from "./types";

interface RefundSummaryProps {
  items: ReturnItem[];
  totalRefundAmount: string;
  totalRefundCurrency?: string;
  resolution: "refund" | "exchange" | "store_credit" | null;
  locale?: Locale;
}

export function RefundSummary({
  items,
  totalRefundAmount,
  totalRefundCurrency = "EUR",
  resolution,
  locale = "nl",
}: RefundSummaryProps) {
  const isCredit = resolution === "store_credit";
  const isExchange = resolution === "exchange";

  return (
    <div className="rp-refund-summary">
      <p className="rp-refund-summary__title">{t(locale, "confirm.refundHeader")}</p>

      {items.map((item) => (
        <div key={item.id} className="rp-refund-summary__row">
          <span className="rp-refund-summary__label">
            {item.productTitle}
            {item.variantTitle && (
              <span style={{ color: "var(--color-slate)", marginLeft: "4px" }}>
                ({item.variantTitle})
              </span>
            )}
            {" "}x{item.quantity}
          </span>
          <span className="rp-refund-summary__amount">
            {formatPrice(
              parseFloat(item.unitPrice) * item.quantity,
              totalRefundCurrency,
            )}
          </span>
        </div>
      ))}

      <div className="rp-refund-summary__row rp-refund-summary__row--total">
        <span className="rp-refund-summary__label--strong">
          {isExchange
            ? (locale === "nl" ? "Ruilwaarde" : "Exchange value")
            : isCredit
            ? (locale === "nl" ? "Tegoed (incl. 5% bonus)" : "Store credit (incl. 5% bonus)")
            : (locale === "nl" ? "Terug te ontvangen" : "Total refund")}
        </span>
        <span className="rp-refund-summary__amount" style={{ fontWeight: 600 }}>
          {formatPrice(totalRefundAmount, totalRefundCurrency)}
        </span>
      </div>

      <p className="rp-refund-summary__timeline">
        {t(locale, "confirm.estimatedTimeline")}
      </p>
    </div>
  );
}

/**
 * OrderHeader component — JANICE Returns Portal
 *
 * Toont bestelreferentie, datum en totaalbedrag.
 * Bedrag altijd in JANICE-formaat: "249,95 EUR".
 */

import type { Locale } from "~/i18n";
import { t } from "~/i18n";
import { formatPrice } from "./types";

interface OrderHeaderProps {
  orderName: string;
  orderDate: string;
  totalPrice: string;
  currency?: string;
  locale?: Locale;
}

export function OrderHeader({
  orderName,
  orderDate,
  totalPrice,
  currency = "EUR",
  locale = "nl",
}: OrderHeaderProps) {
  const dateFormatted = new Date(orderDate).toLocaleDateString(
    locale === "nl" ? "nl-NL" : "en-GB",
    { year: "numeric", month: "long", day: "numeric" },
  );

  return (
    <div className="rp-order-header">
      <p className="rp-order-header__label">{t(locale, "items.orderLabel")}</p>
      <p className="rp-order-header__number">{orderName}</p>
      <div className="rp-order-header__meta">
        <span>
          <span aria-hidden="true">{t(locale, "items.dateLabel")}: </span>
          <time dateTime={orderDate}>{dateFormatted}</time>
        </span>
        <span>
          <span aria-hidden="true">{t(locale, "items.totalLabel")}: </span>
          <span>{formatPrice(totalPrice, currency)}</span>
        </span>
      </div>
    </div>
  );
}

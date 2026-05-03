// @vitest-environment jsdom
/**
 * Tests voor RefundSummary component
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RefundSummary } from "../returns/RefundSummary";
import type { ReturnItem } from "../returns/types";

const mockItems: ReturnItem[] = [
  {
    id: "item-1",
    shopifyLineItemId: "shopify-line-1",
    productTitle: "JANICE Jas",
    variantTitle: "Maat S",
    quantity: 1,
    unitPrice: "199.95",
    reasonCode: "TOO_BIG",
  },
  {
    id: "item-2",
    shopifyLineItemId: "shopify-line-2",
    productTitle: "JANICE Broek",
    variantTitle: null,
    quantity: 2,
    unitPrice: "99.95",
    reasonCode: "CHANGED_MIND",
  },
];

describe("RefundSummary", () => {
  it("toont alle artikelen", () => {
    render(
      <RefundSummary
        items={mockItems}
        totalRefundAmount="399.85"
        resolution="refund"
        locale="nl"
      />,
    );
    expect(screen.getByText(/JANICE Jas/)).toBeInTheDocument();
    expect(screen.getByText(/JANICE Broek/)).toBeInTheDocument();
  });

  it("toont bedrag in JANICE formaat", () => {
    render(
      <RefundSummary
        items={mockItems}
        totalRefundAmount="399.85"
        resolution="refund"
        locale="nl"
      />,
    );
    expect(screen.getByText("399,85 EUR")).toBeInTheDocument();
  });

  it("toont 'Tegoed' label bij store_credit", () => {
    render(
      <RefundSummary
        items={mockItems}
        totalRefundAmount="399.85"
        resolution="store_credit"
        locale="nl"
      />,
    );
    expect(screen.getByText(/Tegoed/)).toBeInTheDocument();
  });

  it("toont 'Ruilwaarde' label bij exchange", () => {
    render(
      <RefundSummary
        items={mockItems}
        totalRefundAmount="399.85"
        resolution="exchange"
        locale="nl"
      />,
    );
    expect(screen.getByText("Ruilwaarde")).toBeInTheDocument();
  });

  it("toont tijdsindicatie", () => {
    render(
      <RefundSummary
        items={mockItems}
        totalRefundAmount="399.85"
        resolution="refund"
        locale="nl"
      />,
    );
    expect(screen.getByText(/Label binnen 1 uur/)).toBeInTheDocument();
  });

  it("toont varianttitel als aanwezig", () => {
    render(
      <RefundSummary
        items={mockItems}
        totalRefundAmount="399.85"
        resolution="refund"
        locale="nl"
      />,
    );
    expect(screen.getByText(/Maat S/)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
/**
 * Tests voor OrderHeader component
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OrderHeader } from "../returns/OrderHeader";

describe("OrderHeader", () => {
  const defaultProps = {
    orderName: "#1042",
    orderDate: "2025-04-15T10:00:00.000Z",
    totalPrice: "249.95",
    currency: "EUR",
  };

  it("toont bestelnummer", () => {
    render(<OrderHeader {...defaultProps} />);
    expect(screen.getByText("#1042")).toBeInTheDocument();
  });

  it("toont bedrag in JANICE formaat (komma decimaal, EUR suffix)", () => {
    render(<OrderHeader {...defaultProps} />);
    expect(screen.getByText("249,95 EUR")).toBeInTheDocument();
  });

  it("toont datumformattering in NL", () => {
    render(<OrderHeader {...defaultProps} locale="nl" />);
    // Controleer of de <time> element aanwezig is
    const timeEl = document.querySelector("time");
    expect(timeEl).toBeInTheDocument();
    expect(timeEl).toHaveAttribute("dateTime", "2025-04-15T10:00:00.000Z");
  });

  it("toont bestelling label", () => {
    render(<OrderHeader {...defaultProps} locale="nl" />);
    expect(screen.getByText("Bestelling")).toBeInTheDocument();
  });

  it("toont totaalbedrag label", () => {
    render(<OrderHeader {...defaultProps} locale="nl" />);
    expect(screen.getByText(/Totaalbedrag/)).toBeInTheDocument();
  });

  it("heeft rp-order-header klasse", () => {
    const { container } = render(<OrderHeader {...defaultProps} />);
    expect(container.firstChild).toHaveClass("rp-order-header");
  });
});

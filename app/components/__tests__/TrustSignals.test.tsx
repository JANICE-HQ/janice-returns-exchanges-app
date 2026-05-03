// @vitest-environment jsdom
/**
 * Tests voor TrustSignals component
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TrustSignals } from "../returns/TrustSignals";

describe("TrustSignals", () => {
  it("rendert exact 5 signalen (Rule of 5/7)", () => {
    render(<TrustSignals locale="nl" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
  });

  it("toont NL teksten", () => {
    render(<TrustSignals locale="nl" />);
    expect(screen.getByText(/30 dagen retourperiode/)).toBeInTheDocument();
    expect(screen.getByText(/Gratis retourneren/)).toBeInTheDocument();
  });

  it("toont EN teksten", () => {
    render(<TrustSignals locale="en" />);
    expect(screen.getByText(/30-day return window/)).toBeInTheDocument();
    expect(screen.getByText(/Free returns within the EU/)).toBeInTheDocument();
  });

  it("heeft aside role met aria-label", () => {
    render(<TrustSignals locale="nl" />);
    const aside = screen.getByRole("complementary");
    expect(aside).toHaveAttribute("aria-label");
  });

  it("toont sectietitel", () => {
    render(<TrustSignals locale="nl" />);
    expect(screen.getByText("Waarom retourneren bij JANICE")).toBeInTheDocument();
  });
});

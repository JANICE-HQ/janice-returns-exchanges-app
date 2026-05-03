// @vitest-environment jsdom
/**
 * Tests voor de succesboodschappagina
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("react-router", () => ({
  useLoaderData: vi.fn(() => ({
    locale: "nl",
    returnId: "abc123de-efgh-ijkl-mnop-qrstuvwxyz01",
    orderName: "#1042",
    guestToken: null,
  })),
}));

vi.mock("~/styles/returns-portal.css", () => ({}));

import SuccessPage from "../apps.returns.success.$returnId";

describe("SuccessPage", () => {
  it("toont bevestigingstitel", () => {
    render(<SuccessPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Retour ingediend");
  });

  it("toont retour-ID", () => {
    render(<SuccessPage />);
    expect(screen.getByText(/ABC123DE/)).toBeInTheDocument();
  });

  it("toont bestelnummer", () => {
    render(<SuccessPage />);
    expect(screen.getByText(/#1042/)).toBeInTheDocument();
  });

  it("toont exact 5 volgende stappen (Rule of 5/7)", () => {
    render(<SuccessPage />);
    const stepNumbers = document.querySelectorAll(".rp-success__step-number");
    expect(stepNumbers).toHaveLength(5);
  });

  it("toont CTA terug naar account", () => {
    render(<SuccessPage />);
    expect(screen.getByText("Terug naar mijn account")).toBeInTheDocument();
  });

  it("toont CTA terug naar winkel", () => {
    render(<SuccessPage />);
    expect(screen.getByText("Terug naar de winkel")).toBeInTheDocument();
  });

  it("heeft skip-to-content link", () => {
    render(<SuccessPage />);
    expect(screen.getByText(/Ga naar inhoud/)).toBeInTheDocument();
  });

  it("verwijst 'terug naar account' naar /account", () => {
    render(<SuccessPage />);
    const link = screen.getByText("Terug naar mijn account").closest("a");
    expect(link).toHaveAttribute("href", "/account");
  });

  it("verwijst 'terug naar winkel' naar /", () => {
    render(<SuccessPage />);
    const link = screen.getByText("Terug naar de winkel").closest("a");
    expect(link).toHaveAttribute("href", "/");
  });

  it("toont bevestigingsmarkering", () => {
    render(<SuccessPage />);
    const checkIcon = document.querySelector(".rp-success__check");
    expect(checkIcon).toBeInTheDocument();
  });
});

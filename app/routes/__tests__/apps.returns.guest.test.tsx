// @vitest-environment jsdom
/**
 * Tests voor de gast-lookup pagina
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Maak mock functies beschikbaar voor testoverschrijvingen
const mockUseActionData = vi.fn(() => null as null | { error?: string; errorType?: string; retryAfterSeconds?: number });
const mockUseNavigation = vi.fn(() => ({ state: "idle" as "idle" | "submitting" | "loading" }));

vi.mock("react-router", () => ({
  useLoaderData: vi.fn(() => ({ locale: "nl" })),
  useActionData: () => mockUseActionData(),
  useNavigation: () => mockUseNavigation(),
  Form: ({ children, onSubmit, ...props }: React.FormHTMLAttributes<HTMLFormElement>) => (
    <form onSubmit={onSubmit} {...props}>{children}</form>
  ),
}));

vi.mock("~/styles/returns-portal.css", () => ({}));

import GuestLookup from "../apps.returns.guest";

describe("GuestLookup", () => {
  beforeEach(() => {
    mockUseActionData.mockReturnValue(null);
    mockUseNavigation.mockReturnValue({ state: "idle" });

    // Mock sessionStorage
    Object.defineProperty(window, "sessionStorage", {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });
  });

  it("rendert formulier met twee velden", () => {
    render(<GuestLookup />);
    expect(screen.getByLabelText("Bestelnummer")).toBeInTheDocument();
    expect(screen.getByLabelText("E-mailadres")).toBeInTheDocument();
  });

  it("toont submitknop", () => {
    render(<GuestLookup />);
    expect(screen.getByRole("button", { name: /Bestelling zoeken/ })).toBeInTheDocument();
  });

  it("toont paginatitel", () => {
    render(<GuestLookup />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bestelling opzoeken");
  });

  it("heeft skip-to-content link", () => {
    render(<GuestLookup />);
    expect(screen.getByText(/Ga naar inhoud/)).toBeInTheDocument();
  });

  it("toont terugknop naar landingspagina", () => {
    render(<GuestLookup />);
    const backLink = screen.getByText(/Retourneren of ruilen/);
    expect(backLink.closest("a")).toHaveAttribute("href", "/apps/returns");
  });

  it("toont foutmelding bij not-found actionData", () => {
    mockUseActionData.mockReturnValue({
      error: "Geen bestelling gevonden. Controleer je gegevens.",
      errorType: "not_found",
    });

    render(<GuestLookup />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Geen bestelling gevonden/)).toBeInTheDocument();
  });

  it("toont rate-limit foutmelding", () => {
    mockUseActionData.mockReturnValue({
      error: "Te veel pogingen. Probeer over 5 minuten opnieuw.",
      errorType: "rate_limited",
      retryAfterSeconds: 300,
    });

    render(<GuestLookup />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("vereist bestelnummer invoer", () => {
    render(<GuestLookup />);
    const orderInput = screen.getByLabelText("Bestelnummer");
    expect(orderInput).toHaveAttribute("required");
  });

  it("vereist email invoer", () => {
    render(<GuestLookup />);
    const emailInput = screen.getByLabelText("E-mailadres");
    expect(emailInput).toHaveAttribute("required");
    expect(emailInput).toHaveAttribute("type", "email");
  });

  it("toont laad-status tijdens submit", () => {
    mockUseNavigation.mockReturnValue({ state: "submitting" });

    render(<GuestLookup />);
    const submitBtn = screen.getByRole("button");
    expect(submitBtn).toBeDisabled();
  });
});

// @vitest-environment jsdom
/**
 * Tests voor de landingspagina van het retourportal
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("react-router", () => ({
  useLoaderData: vi.fn(() => ({ locale: "nl", loggedInCustomerId: null })),
  useActionData: vi.fn(() => null),
  useNavigation: vi.fn(() => ({ state: "idle" })),
  Form: ({ children, ...props }: React.FormHTMLAttributes<HTMLFormElement>) => (
    <form {...props}>{children}</form>
  ),
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

vi.mock("~/styles/returns-portal.css", () => ({}));

import ReturnsLanding from "../apps.returns._index";

describe("ReturnsLanding", () => {
  it("rendert de hoofdtitel", () => {
    render(<ReturnsLanding />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Retourneren of ruilen")).toBeInTheDocument();
  });

  it("toont inloggen CTA", () => {
    render(<ReturnsLanding />);
    expect(screen.getByText("Inloggen om mijn bestelling te zien")).toBeInTheDocument();
  });

  it("toont gast CTA", () => {
    render(<ReturnsLanding />);
    expect(screen.getByText("Bestelling opzoeken als gast")).toBeInTheDocument();
  });

  it("toont 5 vertrouwenssignalen (Rule of 5/7)", () => {
    render(<ReturnsLanding />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
  });

  it("heeft skip-to-content link", () => {
    render(<ReturnsLanding />);
    const skipLink = screen.getByText(/Ga naar inhoud/);
    expect(skipLink).toBeInTheDocument();
    expect(skipLink.tagName.toLowerCase()).toBe("a");
  });

  it("verwijst gast CTA naar /apps/returns/guest", () => {
    render(<ReturnsLanding />);
    const guestLink = screen.getByText("Bestelling opzoeken als gast").closest("a");
    expect(guestLink).toHaveAttribute("href", "/apps/returns/guest");
  });

  it("verwijst login CTA naar /account/login", () => {
    render(<ReturnsLanding />);
    const loginLink = screen.getByText("Inloggen om mijn bestelling te zien").closest("a");
    expect(loginLink?.getAttribute("href")).toContain("/account/login");
  });

  it("toont subtitel over 30 dagen", () => {
    render(<ReturnsLanding />);
    const elementsWithDagen = screen.getAllByText(/30 dagen/);
    expect(elementsWithDagen.length).toBeGreaterThan(0);
  });
});

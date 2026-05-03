// @vitest-environment jsdom
/**
 * Tests voor Timeline component
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Timeline } from "../returns/Timeline";
import type { StateHistoryEntry } from "../returns/types";

const mockHistory: StateHistoryEntry[] = [
  {
    fromState: null,
    toState: "DRAFT",
    actorType: "customer",
    createdAt: "2025-04-10T08:00:00.000Z",
    note: "Retour aangemaakt",
  },
  {
    fromState: "DRAFT",
    toState: "SUBMITTED",
    actorType: "customer",
    createdAt: "2025-04-10T09:00:00.000Z",
    note: "Retour ingediend",
  },
];

describe("Timeline", () => {
  it("rendert alle history entries", () => {
    render(
      <Timeline
        history={mockHistory}
        currentState="SUBMITTED"
        locale="nl"
      />,
    );
    expect(screen.getByText("Concept")).toBeInTheDocument();
    expect(screen.getByText("Ingediend")).toBeInTheDocument();
  });

  it("markeert huidige staat", () => {
    render(
      <Timeline
        history={mockHistory}
        currentState="SUBMITTED"
        locale="nl"
      />,
    );
    // Huidige badge
    expect(screen.getByText("Huidig")).toBeInTheDocument();
  });

  it("toont notities", () => {
    render(
      <Timeline
        history={mockHistory}
        currentState="SUBMITTED"
        locale="nl"
      />,
    );
    expect(screen.getByText("Retour aangemaakt")).toBeInTheDocument();
  });

  it("toont tijdstip van elke overgang", () => {
    render(
      <Timeline
        history={mockHistory}
        currentState="SUBMITTED"
        locale="nl"
      />,
    );
    const timeElements = document.querySelectorAll("time");
    expect(timeElements.length).toBeGreaterThanOrEqual(2);
  });

  it("heeft sectie aria-label", () => {
    render(
      <Timeline
        history={mockHistory}
        currentState="SUBMITTED"
        locale="nl"
      />,
    );
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  it("toont EN vertalingen", () => {
    render(
      <Timeline
        history={mockHistory}
        currentState="SUBMITTED"
        locale="en"
      />,
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
  });
});

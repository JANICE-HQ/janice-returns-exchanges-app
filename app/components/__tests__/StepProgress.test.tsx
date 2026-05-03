// @vitest-environment jsdom
/**
 * Tests voor StepProgress component
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StepProgress } from "../returns/StepProgress";

describe("StepProgress", () => {
  it("rendert 5 stap-indicatoren", () => {
    render(<StepProgress currentStep={1} />);
    // 5 dots verwacht
    const dots = document.querySelectorAll(".rp-step-progress__dot");
    expect(dots).toHaveLength(5);
  });

  it("markeert actieve stap met aria-current=step", () => {
    render(<StepProgress currentStep={3} />);
    const activeDots = document.querySelectorAll('[aria-current="step"]');
    expect(activeDots).toHaveLength(1);
    expect(activeDots[0]).toHaveClass("rp-step-progress__dot--active");
  });

  it("markeert voltooide stappen met --completed klasse", () => {
    render(<StepProgress currentStep={4} />);
    const completedDots = document.querySelectorAll(".rp-step-progress__dot--completed");
    expect(completedDots).toHaveLength(3); // stappen 1, 2, 3 zijn voltooid
  });

  it("heeft geen voltooide stappen bij stap 1", () => {
    render(<StepProgress currentStep={1} />);
    const completedDots = document.querySelectorAll(".rp-step-progress__dot--completed");
    expect(completedDots).toHaveLength(0);
  });

  it("heeft 4 connectors voor 5 stappen", () => {
    render(<StepProgress currentStep={1} />);
    const connectors = document.querySelectorAll(".rp-step-progress__connector");
    expect(connectors).toHaveLength(4);
  });

  it("rendert staplabels in NL", () => {
    render(<StepProgress currentStep={1} locale="nl" />);
    expect(screen.getByText("Artikelen")).toBeInTheDocument();
    expect(screen.getByText("Reden")).toBeInTheDocument();
  });

  it("rendert staplabels in EN", () => {
    render(<StepProgress currentStep={1} locale="en" />);
    expect(screen.getByText("Items")).toBeInTheDocument();
    expect(screen.getByText("Reason")).toBeInTheDocument();
  });

  it("heeft nav element met aria-label", () => {
    render(<StepProgress currentStep={2} />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
});

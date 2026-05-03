// @vitest-environment jsdom
/**
 * Tests voor ResolutionCard component
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ResolutionCard, ResolutionCards } from "../returns/ResolutionCard";

describe("ResolutionCard", () => {
  it("toont refund titel", () => {
    render(
      <ResolutionCard
        value="refund"
        selected={false}
        onChange={vi.fn()}
        locale="nl"
      />,
    );
    expect(screen.getByText("Geld terug")).toBeInTheDocument();
  });

  it("toont exchange titel", () => {
    render(
      <ResolutionCard
        value="exchange"
        selected={false}
        onChange={vi.fn()}
        locale="nl"
      />,
    );
    expect(screen.getByText("Ruilen")).toBeInTheDocument();
  });

  it("toont store_credit titel met bonus badge", () => {
    render(
      <ResolutionCard
        value="store_credit"
        selected={false}
        onChange={vi.fn()}
        locale="nl"
      />,
    );
    expect(screen.getByText("Tegoed")).toBeInTheDocument();
    expect(screen.getByText("+5% bonus")).toBeInTheDocument();
  });

  it("heeft --selected klasse als selected=true", () => {
    const { container } = render(
      <ResolutionCard
        value="refund"
        selected={true}
        onChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toHaveClass("rp-resolution-card--selected");
  });

  it("heeft --disabled klasse als disabled=true", () => {
    const { container } = render(
      <ResolutionCard
        value="exchange"
        selected={false}
        disabled={true}
        onChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toHaveClass("rp-resolution-card--disabled");
  });

  it("roept onChange aan bij klikken op radio", () => {
    const onChange = vi.fn();
    render(
      <ResolutionCard
        value="refund"
        selected={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio"));
    expect(onChange).toHaveBeenCalledWith("refund");
  });

  it("toont tijdsindicatie", () => {
    render(
      <ResolutionCard
        value="refund"
        selected={false}
        onChange={vi.fn()}
        locale="nl"
      />,
    );
    expect(screen.getByText(/5-7 werkdagen/)).toBeInTheDocument();
  });
});

describe("ResolutionCards", () => {
  it("rendert 3 kaarten", () => {
    render(
      <ResolutionCards
        selected={null}
        allowedResolutions={["refund", "exchange", "store_credit"]}
        onChange={vi.fn()}
        locale="nl"
      />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("disabled kaarten die niet in allowedResolutions zitten", () => {
    render(
      <ResolutionCards
        selected="refund"
        allowedResolutions={["refund"]}
        onChange={vi.fn()}
      />,
    );
    const radios = screen.getAllByRole("radio");
    const exchangeRadio = radios.find((r) => (r as HTMLInputElement).value === "exchange");
    expect(exchangeRadio).toBeDisabled();
  });

  it("heeft radiogroup rol", () => {
    render(
      <ResolutionCards
        selected={null}
        allowedResolutions={["refund"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });
});

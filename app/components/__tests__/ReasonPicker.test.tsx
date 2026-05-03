// @vitest-environment jsdom
/**
 * Tests voor ReasonPicker component
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ReasonPicker } from "../returns/ReasonPicker";

describe("ReasonPicker", () => {
  const defaultProps = {
    itemId: "item-1",
    productTitle: "JANICE Jas",
    variantTitle: "Maat S",
    selectedReason: null,
    subnote: "",
    onReasonChange: vi.fn(),
    onSubnoteChange: vi.fn(),
  };

  it("toont 8 redencodes als radio buttons", () => {
    render(<ReasonPicker {...defaultProps} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(8);
  });

  it("toont NL redenlabels", () => {
    render(<ReasonPicker {...defaultProps} locale="nl" />);
    expect(screen.getByText("Te groot")).toBeInTheDocument();
    expect(screen.getByText("Te klein")).toBeInTheDocument();
    expect(screen.getByText("Beschadigd ontvangen")).toBeInTheDocument();
    expect(screen.getByText("Beviel me niet")).toBeInTheDocument();
  });

  it("toont EN redenlabels", () => {
    render(<ReasonPicker {...defaultProps} locale="en" />);
    expect(screen.getByText("Too big")).toBeInTheDocument();
    expect(screen.getByText("Too small")).toBeInTheDocument();
  });

  it("selecteert radio button bij klikken", () => {
    const onReasonChange = vi.fn();
    render(<ReasonPicker {...defaultProps} onReasonChange={onReasonChange} />);
    const radio = screen.getAllByRole("radio")[0];
    fireEvent.click(radio!);
    expect(onReasonChange).toHaveBeenCalledWith("item-1", "TOO_BIG");
  });

  it("toont geselecteerde radio als checked", () => {
    render(<ReasonPicker {...defaultProps} selectedReason="TOO_SMALL" />);
    const toSmallRadio = screen.getByDisplayValue("TOO_SMALL");
    expect(toSmallRadio).toBeChecked();
  });

  it("roept onSubnoteChange aan bij typen in textarea", () => {
    const onSubnoteChange = vi.fn();
    render(<ReasonPicker {...defaultProps} onSubnoteChange={onSubnoteChange} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Toelichting tekst" } });
    expect(onSubnoteChange).toHaveBeenCalledWith("item-1", "Toelichting tekst");
  });

  it("toont foutmelding als error prop aanwezig is", () => {
    render(<ReasonPicker {...defaultProps} error="Selecteer een reden" />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("Selecteer een reden");
  });

  it("toont tekenteller voor textarea", () => {
    render(<ReasonPicker {...defaultProps} subnote="Test" />);
    expect(screen.getByText(/4 \/ 500/)).toBeInTheDocument();
  });

  it("toont producttitel", () => {
    render(<ReasonPicker {...defaultProps} />);
    expect(screen.getByText("JANICE Jas")).toBeInTheDocument();
  });

  it("bevat fieldset met legend voor toegankelijkheid", () => {
    render(<ReasonPicker {...defaultProps} />);
    expect(screen.getByRole("group")).toBeInTheDocument();
  });
});

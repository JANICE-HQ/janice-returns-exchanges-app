// @vitest-environment jsdom
/**
 * Tests voor LineItemRow component
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LineItemRow } from "../returns/LineItemRow";

const defaultItem = {
  id: "item-1",
  productTitle: "JANICE Jas",
  variantTitle: "Maat S",
  quantity: 2,
  unitPrice: "199.95",
  imageUrl: null,
  isEligible: true,
};

describe("LineItemRow", () => {
  it("toont producttitel", () => {
    render(
      <LineItemRow
        item={defaultItem}
        selected={false}
        selectedQty={1}
        onToggle={vi.fn()}
        onQtyChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText("JANICE Jas").length).toBeGreaterThan(0);
  });

  it("toont varianttitel", () => {
    render(
      <LineItemRow
        item={defaultItem}
        selected={false}
        selectedQty={1}
        onToggle={vi.fn()}
        onQtyChange={vi.fn()}
      />,
    );
    const variantElements = screen.getAllByText(/Maat S/);
    expect(variantElements.length).toBeGreaterThan(0);
  });

  it("toont prijs in JANICE formaat", () => {
    render(
      <LineItemRow
        item={defaultItem}
        selected={false}
        selectedQty={1}
        onToggle={vi.fn()}
        onQtyChange={vi.fn()}
      />,
    );
    expect(screen.getByText("199,95 EUR")).toBeInTheDocument();
  });

  it("roept onToggle aan bij checkbox klikken", () => {
    const onToggle = vi.fn();
    render(
      <LineItemRow
        item={defaultItem}
        selected={false}
        selectedQty={1}
        onToggle={onToggle}
        onQtyChange={vi.fn()}
      />,
    );
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith("item-1", true);
  });

  it("toont qty stepper als geselecteerd", () => {
    render(
      <LineItemRow
        item={defaultItem}
        selected={true}
        selectedQty={1}
        onToggle={vi.fn()}
        onQtyChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("verbergt qty stepper als niet geselecteerd", () => {
    render(
      <LineItemRow
        item={defaultItem}
        selected={false}
        selectedQty={1}
        onToggle={vi.fn()}
        onQtyChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("decrement knop verhoogt niet boven maximum", () => {
    const onQtyChange = vi.fn();
    render(
      <LineItemRow
        item={defaultItem}
        selected={true}
        selectedQty={2}
        onToggle={vi.fn()}
        onQtyChange={onQtyChange}
      />,
    );
    const incBtn = screen.getByLabelText("Meer");
    expect(incBtn).toBeDisabled(); // max is 2 (purchased qty)
  });

  it("decrement knop is uitgeschakeld bij qty 1", () => {
    render(
      <LineItemRow
        item={defaultItem}
        selected={true}
        selectedQty={1}
        onToggle={vi.fn()}
        onQtyChange={vi.fn()}
      />,
    );
    const decBtn = screen.getByLabelText("Minder");
    expect(decBtn).toBeDisabled();
  });

  it("toont eligibility blocker als isEligible=false", () => {
    render(
      <LineItemRow
        item={{
          ...defaultItem,
          isEligible: false,
          eligibilityBlockerKey: "final_sale",
        }}
        selected={false}
        selectedQty={1}
        onToggle={vi.fn()}
        onQtyChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Final sale/)).toBeInTheDocument();
  });

  it("checkbox is uitgeschakeld als isEligible=false", () => {
    render(
      <LineItemRow
        item={{ ...defaultItem, isEligible: false }}
        selected={false}
        selectedQty={1}
        onToggle={vi.fn()}
        onQtyChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});

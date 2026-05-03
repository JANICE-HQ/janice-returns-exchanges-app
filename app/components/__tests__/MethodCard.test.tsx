// @vitest-environment jsdom
/**
 * Tests voor MethodCard component
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MethodCard, MethodCards } from "../returns/MethodCard";

describe("MethodCard", () => {
  it("toont QR-code titel", () => {
    render(
      <MethodCard
        value="qr"
        selected={false}
        onChange={vi.fn()}
        locale="nl"
      />,
    );
    expect(screen.getByText(/DHL Pakketpunt/)).toBeInTheDocument();
  });

  it("toont label titel", () => {
    render(
      <MethodCard
        value="label"
        selected={false}
        onChange={vi.fn()}
        locale="nl"
      />,
    );
    expect(screen.getByText(/Print zelf je label/)).toBeInTheDocument();
  });

  it("toont Aanbevolen badge op QR", () => {
    render(
      <MethodCard
        value="qr"
        selected={false}
        onChange={vi.fn()}
        locale="nl"
      />,
    );
    expect(screen.getByText("Aanbevolen")).toBeInTheDocument();
  });

  it("heeft geen Aanbevolen badge op label", () => {
    render(
      <MethodCard
        value="label"
        selected={false}
        onChange={vi.fn()}
        locale="nl"
      />,
    );
    expect(screen.queryByText("Aanbevolen")).toBeNull();
  });

  it("heeft --selected klasse als selected=true", () => {
    const { container } = render(
      <MethodCard
        value="qr"
        selected={true}
        onChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toHaveClass("rp-method-card--selected");
  });

  it("roept onChange aan bij klikken", () => {
    const onChange = vi.fn();
    render(
      <MethodCard
        value="label"
        selected={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio"));
    expect(onChange).toHaveBeenCalledWith("label");
  });
});

describe("MethodCards", () => {
  it("rendert 2 kaarten", () => {
    render(
      <MethodCards
        selected="qr"
        onChange={vi.fn()}
        locale="nl"
      />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("QR is standaard geselecteerd", () => {
    render(
      <MethodCards
        selected="qr"
        onChange={vi.fn()}
      />,
    );
    const qrRadio = screen.getByDisplayValue("qr");
    expect(qrRadio).toBeChecked();
  });

  it("heeft radiogroup rol", () => {
    render(
      <MethodCards
        selected="qr"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });
});

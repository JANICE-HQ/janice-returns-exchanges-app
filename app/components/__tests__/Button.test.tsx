// @vitest-environment jsdom
/**
 * Tests voor Button component
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Button } from "../returns/Button";

describe("Button", () => {
  it("rendert met primary variant (standaard)", () => {
    render(<Button>Verder</Button>);
    const btn = screen.getByRole("button", { name: "Verder" });
    expect(btn).toHaveClass("rp-btn--primary");
    expect(btn).not.toHaveClass("rp-btn--secondary");
  });

  it("rendert met secondary variant", () => {
    render(<Button variant="secondary">Terug</Button>);
    const btn = screen.getByRole("button", { name: "Terug" });
    expect(btn).toHaveClass("rp-btn--secondary");
    expect(btn).not.toHaveClass("rp-btn--primary");
  });

  it("heeft rp-btn--full-width klasse als fullWidth=true", () => {
    render(<Button fullWidth>Indienen</Button>);
    const btn = screen.getByRole("button", { name: "Indienen" });
    expect(btn).toHaveClass("rp-btn--full-width");
  });

  it("roept onClick aan bij klikken", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Klik</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Klik" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is uitgeschakeld als disabled=true", () => {
    render(<Button disabled>Uitgeschakeld</Button>);
    expect(screen.getByRole("button", { name: "Uitgeschakeld" })).toBeDisabled();
  });

  it("geeft geen onClick-event bij disabled knop", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Uitgeschakeld</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Uitgeschakeld" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("accepteert aangepaste className", () => {
    render(<Button className="extra-class">Knop</Button>);
    expect(screen.getByRole("button")).toHaveClass("extra-class");
  });

  it("geeft aria-busy door", () => {
    render(<Button aria-busy={true}>Bezig</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });
});

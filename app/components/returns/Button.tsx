/**
 * Button component — JANICE Returns Portal
 *
 * 0px corners (brand law), Onyx kleur, Futura PT.
 * Ondersteunt primary/secondary variant en full-width op mobile.
 */

import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  fullWidth = false,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "rp-btn",
        variant === "primary" && "rp-btn--primary",
        variant === "secondary" && "rp-btn--secondary",
        fullWidth && "rp-btn--full-width",
        !fullWidth && "rp-btn--full-width-mobile",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

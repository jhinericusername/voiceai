"use client";

import type { ReactNode } from "react";
import { primaryButtonClass, secondaryButtonClass } from "./dashboard-ui";

export function DashboardActionButton({
  action,
  children,
  variant = "primary",
}: {
  readonly action: "interview" | "invite";
  readonly children: ReactNode;
  readonly variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new CustomEvent("puddle-dashboard-action", { detail: { action } }));
      }}
      className={variant === "primary" ? primaryButtonClass : secondaryButtonClass}
    >
      {children}
    </button>
  );
}

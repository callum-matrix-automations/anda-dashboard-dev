import type { ReactNode } from "react";
import { cn } from "@/frontend/components/design-system/lib/utils";

// AIDEV-NOTE: Full-bleed banner used inside the review/signing card for lifecycle state
// (analysis, PDF, signing, archive). Replaces the DaisyUI `alert ... border-x-0 border-t-0`
// pattern with tokenised tones. `role` defaults to "status"; pass "alert" for failures.
type Tone = "info" | "success" | "warning" | "error";

const toneClass: Record<Tone, string> = {
  info: "border-info/30 bg-info/10 text-foreground",
  success: "border-secondary/30 bg-secondary/10 text-foreground",
  warning: "border-warning/40 bg-warning/10 text-foreground",
  error: "border-destructive/30 bg-destructive/10 text-foreground",
};

export function StatusBanner({
  tone,
  role = "status",
  className,
  children,
}: {
  tone: Tone;
  role?: "status" | "alert";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 text-sm",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

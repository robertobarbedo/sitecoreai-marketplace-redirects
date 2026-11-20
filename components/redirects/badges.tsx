import { mdiLoading } from "@mdi/js";

import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";
import type { TestLevel, TestState } from "@/src/types/redirects";

/** Small mono tag for a language code or a link kind. */
export function Tag({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md bg-surface-container px-1.5 py-0.5 font-mono text-[10px] font-bold text-on-surface-variant",
        className,
      )}
    >
      {children}
    </span>
  );
}

export const LEVEL_LABEL: Record<TestLevel, string> = {
  working: "Working",
  warning: "Warning",
  broken: "Broken",
  error: "Not tested",
};

const LEVEL_STYLE: Record<TestLevel, string> = {
  working: "bg-success-bg text-success-fg",
  warning: "bg-[#ffe6bd] text-[#953d00]",
  broken: "bg-danger-bg text-danger-fg",
  error: "bg-surface-container text-on-surface-variant",
};

const PILL = "inline-flex items-center gap-1 rounded-xl px-2.5 py-0.5 text-xs font-bold";

/** The test result pill of a row. */
export function ResultBadge({ state }: { state: TestState | undefined }) {
  if (!state) {
    return (
      <span className={cn(PILL, "bg-surface-container text-on-surface-variant")}>
        Not tested
      </span>
    );
  }
  if (state === "queued") {
    return (
      <span className={cn(PILL, "bg-surface-container text-on-surface-variant")}>
        Queued
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className={cn(PILL, "bg-primary-bg text-primary-fg")}>
        <Icon path={mdiLoading} size={0.5} className="animate-spin" />
        Testing
      </span>
    );
  }
  return (
    <span className={cn(PILL, LEVEL_STYLE[state.level])}>
      {LEVEL_LABEL[state.level]}
    </span>
  );
}

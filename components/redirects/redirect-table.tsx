"use client";

import { Fragment } from "react";
import { mdiArrowRight, mdiPencilOutline, mdiTrashCanOutline } from "@mdi/js";

import { ResultBadge, Tag } from "@/components/redirects/badges";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";
import { ROW_PAGE_SIZE } from "@/src/constants";
import type { RedirectRow, TestState } from "@/src/types/redirects";
import { formatDate, formatUser } from "@/src/utils/format";

const GRID =
  "grid grid-cols-[minmax(0,1.1fr)_24px_minmax(0,1.5fr)_190px_150px_150px] items-center gap-4 px-4";

/** What the "Redirects to" cell shows for a row. */
function destination(row: RedirectRow): {
  label: string;
  sub: string;
  kind: string;
  missing: boolean;
} {
  if (row.link.kind === "external") {
    let host = row.link.url;
    try {
      host = new URL(row.link.url).host || row.link.url;
    } catch {
      // Relative or malformed URL — show it as typed.
    }
    return { label: host, sub: row.link.url, kind: "External", missing: false };
  }
  if (row.link.kind === "internal") {
    if (row.targetPath === null) {
      return {
        label: "Destination item not found",
        sub: "The linked item was deleted, or has no version in this language",
        kind: "Internal",
        missing: true,
      };
    }
    return {
      label: row.targetName,
      sub: row.targetRoute || row.targetPath,
      kind: "Internal",
      missing: false,
    };
  }
  return {
    label: "No destination set",
    sub: "The destination field is empty",
    kind: "Empty",
    missing: true,
  };
}

export function RedirectTable({
  rows,
  page,
  onPageChange,
  tests,
  expandedKey,
  onToggleDetails,
  onTest,
  onEdit,
  onDelete,
  onPointTo,
  busy,
  base,
}: {
  rows: RedirectRow[];
  page: number;
  onPageChange: (page: number) => void;
  tests: Record<string, TestState>;
  expandedKey: string | null;
  onToggleDetails: (key: string) => void;
  onTest: (row: RedirectRow) => void;
  onEdit: (row: RedirectRow) => void;
  onDelete: (row: RedirectRow) => void;
  /** Re-point a chained redirect straight at the URL it ends on. */
  onPointTo: (row: RedirectRow, finalUrl: string) => void;
  /** Disables the row actions while a save, delete or scan is running. */
  busy: boolean;
  base: string;
}) {
  const pageCount = Math.max(1, Math.ceil(rows.length / ROW_PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const start = current * ROW_PAGE_SIZE;
  const visible = rows.slice(start, start + ROW_PAGE_SIZE);

  return (
    <div className="overflow-x-auto rounded-xl border border-border-muted bg-white">
      <div className="min-w-[980px]">
        <div
          className={cn(
            GRID,
            "border-b border-border-muted py-3 text-xs font-bold uppercase tracking-wider text-text-subtle",
          )}
        >
          <div>From</div>
          <div />
          <div>Redirects to</div>
          <div>Test result</div>
          <div>Last modified</div>
          <div className="text-right">Actions</div>
        </div>

        {visible.map((row) => {
          const dest = destination(row);
          const state = tests[row.key];
          const result = typeof state === "object" ? state : null;
          const testing = state === "running" || state === "queued";
          const expanded = expandedKey === row.key && result !== null;
          const lastHop = result?.hops[result.hops.length - 1];
          const canPointTo =
            result?.level === "warning" &&
            result.hops.length > 2 &&
            lastHop !== undefined;

          return (
            <Fragment key={row.key}>
              <div className="border-b border-border-muted">
                <div className={cn(GRID, "min-h-[60px] py-2.5")}>
                  <div
                    className="truncate font-mono text-[13px]"
                    title={`${base}${row.from}`}
                  >
                    {row.from}
                  </div>
                  <Icon
                    path={mdiArrowRight}
                    size={0.75}
                    className="text-text-subtle"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate font-semibold",
                          dest.missing && "text-danger-fg",
                        )}
                      >
                        {dest.label}
                      </span>
                      <Tag className="uppercase tracking-wider">{dest.kind}</Tag>
                    </div>
                    <div
                      className="truncate font-mono text-xs text-text-subtle"
                      title={dest.sub}
                    >
                      {dest.sub}
                    </div>
                  </div>
                  <div className="min-w-0">
                    {result ? (
                      <button
                        type="button"
                        onClick={() => onToggleDetails(row.key)}
                        aria-expanded={expanded}
                        title={expanded ? "Hide test details" : "Show test details"}
                        className="group cursor-pointer rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-primary/50"
                      >
                        <ResultBadge state={state} expandable expanded={expanded} />
                      </button>
                    ) : (
                      <ResultBadge state={state} />
                    )}
                    {result && (
                      <div className="mt-0.5 truncate text-xs text-text-subtle">
                        {result.note}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate">{formatDate(row.updated)}</div>
                    <div className="truncate text-xs text-text-subtle">
                      {formatUser(row.updatedBy)}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || testing}
                      onClick={() => onTest(row)}
                    >
                      Test
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${row.from}`}
                      title="Edit"
                      disabled={busy}
                      onClick={() => onEdit(row)}
                    >
                      <Icon path={mdiPencilOutline} size={0.75} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${row.from}`}
                      title="Delete"
                      disabled={busy}
                      onClick={() => onDelete(row)}
                      className="text-danger-fg hover:text-danger-fg"
                    >
                      <Icon path={mdiTrashCanOutline} size={0.75} />
                    </Button>
                  </div>
                </div>

                {expanded && result && (
                  <div className="mx-4 mb-3.5 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border-muted bg-surface p-4">
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="font-semibold">{result.detail}</div>
                      {result.hops.map((hop, index) => (
                        <div
                          key={`${hop.url}|${index}`}
                          className="flex items-center gap-2.5 font-mono text-xs"
                        >
                          <span
                            className={cn(
                              "w-9 shrink-0 rounded-md py-0.5 text-center font-bold",
                              hop.status >= 400
                                ? "bg-danger-bg text-danger-fg"
                                : hop.status >= 300
                                  ? "bg-surface-container text-on-surface-variant"
                                  : "bg-success-bg text-success-fg",
                            )}
                          >
                            {hop.status}
                          </span>
                          <span className="break-all text-on-surface-variant">
                            {hop.url.replace(/^https?:\/\//i, "")}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      {canPointTo && lastHop && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => onPointTo(row, lastHop.url)}
                        >
                          Point to the final page
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleDetails(row.key)}
                      >
                        Hide details
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}

        <div className="flex items-center justify-between px-4 py-3 text-xs text-text-subtle">
          <div>
            Showing {rows.length === 0 ? 0 : start + 1}–
            {Math.min(start + ROW_PAGE_SIZE, rows.length)} of {rows.length}{" "}
            {rows.length === 1 ? "redirect" : "redirects"}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={current === 0}
              onClick={() => onPageChange(current - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={current >= pageCount - 1}
              onClick={() => onPageChange(current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

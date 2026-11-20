"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { mdiCheck, mdiChevronDown, mdiCog, mdiMagnify } from "@mdi/js";

import { Tag } from "@/components/redirects/badges";
import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";
import type { SiteUrl } from "@/src/types/redirects";
import { displayBase } from "@/src/utils/urls";

export interface SiteGroup {
  siteName: string;
  urls: SiteUrl[];
}

/**
 * One dropdown for site and language. Site names are headings (not
 * selectable) with a cog that opens that site's setup; the selectable rows are
 * the live URLs, tagged with their language.
 */
export function SitePicker({
  groups,
  selected,
  onSelect,
  onConfigure,
}: {
  groups: SiteGroup[];
  selected: SiteUrl | null;
  onSelect: (url: SiteUrl) => void;
  onConfigure: (siteName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visibleGroups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        urls: group.siteName.toLowerCase().includes(needle)
          ? group.urls
          : group.urls.filter(
              (url) =>
                url.base.toLowerCase().includes(needle) ||
                url.language.toLowerCase().includes(needle),
            ),
      }))
      .filter((group) => group.urls.length > 0);
  }, [groups, filter]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 max-w-[420px] items-center gap-2 rounded-xl border border-border-muted bg-white px-3 text-on-surface outline-none hover:bg-surface-container focus-visible:ring-[3px] focus-visible:ring-primary/50"
      >
        {selected ? (
          <>
            <span className="truncate font-mono text-[13px] font-medium">
              {displayBase(selected.base) === "No live URL"
                ? selected.siteName
                : displayBase(selected.base)}
            </span>
            <Tag>{selected.language}</Tag>
          </>
        ) : (
          <span className="text-text-subtle">Select a site</span>
        )}
        <Icon path={mdiChevronDown} size={0.7} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-[400px] max-w-[calc(100vw-4rem)] rounded-xl border border-border-muted bg-white p-2 shadow-xl">
          <label className="mb-1 flex h-9 items-center gap-2 rounded-xl border border-border-muted px-2.5 text-text-subtle focus-within:border-primary">
            <Icon path={mdiMagnify} size={0.65} />
            <input
              autoFocus
              type="search"
              aria-label="Find a site or URL"
              placeholder="Find..."
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-on-surface outline-none placeholder:text-text-subtle"
            />
          </label>

          <div className="max-h-[420px] overflow-y-auto">
            {visibleGroups.length === 0 && (
              <p className="px-2.5 py-4 text-center text-xs text-text-subtle">
                Nothing matches.
              </p>
            )}
            {visibleGroups.map((group, index) => (
              <div
                key={group.siteName}
                className={cn(
                  "flex flex-col gap-0.5 pt-1",
                  index > 0 && "mt-1 border-t border-border-muted",
                )}
              >
                <div className="flex items-center justify-between gap-2 py-0.5 pl-2.5 pr-1">
                  <span className="truncate text-xs font-bold uppercase tracking-wider text-text-subtle">
                    {group.siteName}
                  </span>
                  <button
                    type="button"
                    aria-label={`Configure ${group.siteName}`}
                    title={`Configure ${group.siteName}`}
                    onClick={() => {
                      setOpen(false);
                      onConfigure(group.siteName);
                    }}
                    className="flex size-8 items-center justify-center rounded-xl text-on-surface-variant outline-none hover:bg-surface-container focus-visible:ring-[3px] focus-visible:ring-primary/50"
                  >
                    <Icon path={mdiCog} size={0.65} />
                  </button>
                </div>
                {group.urls.map((url) => {
                  const isSelected =
                    selected?.siteName === url.siteName &&
                    selected.language === url.language;
                  return (
                    <button
                      key={`${url.siteName}|${url.language}`}
                      type="button"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => {
                        setOpen(false);
                        setFilter("");
                        onSelect(url);
                      }}
                      className={cn(
                        "flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-left outline-none hover:bg-surface-container focus-visible:ring-[3px] focus-visible:ring-primary/50",
                        isSelected && "bg-primary-bg hover:bg-primary-bg",
                      )}
                    >
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate font-mono text-[13px] font-medium",
                          !url.base && "font-sans text-text-subtle",
                        )}
                      >
                        {displayBase(url.base)}
                      </span>
                      <Tag>{url.language}</Tag>
                      <Icon
                        path={mdiCheck}
                        size={0.65}
                        className={cn(
                          "shrink-0 text-primary-fg",
                          !isSelected && "opacity-0",
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  mdiAlertCircleOutline,
  mdiCheck,
  mdiFileTreeOutline,
  mdiLoading,
} from "@mdi/js";

import { Tag } from "@/components/redirects/badges";
import { ContentTreeDialog } from "@/components/redirects/content-tree-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";
import type { RedirectDraft, RedirectRow } from "@/src/types/redirects";
import type {
  SitecoreItemRef,
  TreeNode,
} from "@/src/utils/sitecore-graphql";
import { displayBase, routeOf } from "@/src/utils/urls";

// Sentence-case labels (not the uppercase field-label style) so they read as
// "type here" prompts rather than section headings.
const LABEL = "text-sm font-semibold text-on-surface";
// Values are mono; placeholders are lighter sans "e.g." examples so they can't
// be mistaken for a filled-in value.
const FIELD =
  "h-10 min-w-0 flex-1 bg-transparent px-3 font-mono text-[13px] text-on-surface outline-none placeholder:font-sans placeholder:text-[#94a3b8]";
// A white box with a visible slate border, so the inputs stand out from the
// dialog surface.
const FIELD_BOX =
  "flex h-10 items-center overflow-hidden rounded-xl border border-[#cbd5e1] bg-white shadow-xs transition-colors hover:border-[#94a3b8] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/50 focus-within:hover:border-primary";

function Required() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-danger-fg">
      *
    </span>
  );
}

type DestinationKind = "internal" | "external";

/**
 * Adds `https://` when the user typed no scheme (`www.example.com/x`,
 * `//www.example.com/x`). Values that already have one are left as they are.
 */
function withScheme(value: string): string {
  const url = value.trim();
  if (!url || /^[a-z][a-z\d+.-]*:\/\//i.test(url)) return url;
  return `https://${url.replace(/^\/+/, "")}`;
}

/** An http(s) URL whose host looks like a real domain. */
function isValidWebUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname.includes(".")
    );
  } catch {
    return false;
  }
}

/**
 * Create or edit one redirect. The dialog only collects and validates the
 * values; saving, publishing and testing happen in the progress dialog.
 */
export function RedirectDialog({
  open,
  row,
  siteName,
  base,
  language,
  languageCount,
  defaultPublish,
  treeRootPath,
  routeRootPath,
  onResolve,
  onLoadChildren,
  onSubmit,
  onClose,
}: {
  open: boolean;
  /** The redirect being edited; null creates a new one. */
  row: RedirectRow | null;
  siteName: string;
  base: string;
  language: string;
  /** Languages of the site, for the "all languages" option. */
  languageCount: number;
  defaultPublish: boolean;
  /** Sitecore path of the site's Home item, the content tree's root. */
  treeRootPath: string;
  /** Item path that answers the site URL's `/` (for showing picked routes). */
  routeRootPath: string;
  onResolve: (input: string) => Promise<SitecoreItemRef | null>;
  onLoadChildren: (path: string) => Promise<TreeNode[]>;
  onSubmit: (draft: RedirectDraft) => void;
  onClose: () => void;
}) {
  const isEdit = row !== null;

  const [from, setFrom] = useState("");
  const [kind, setKind] = useState<DestinationKind>("internal");
  const [internalInput, setInternalInput] = useState("");
  // undefined = not checked yet, null = checked and not found
  const [resolved, setResolved] = useState<SitecoreItemRef | null | undefined>(
    undefined,
  );
  const [checking, setChecking] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");
  const [allLanguages, setAllLanguages] = useState(false);
  const [publish, setPublish] = useState(defaultPublish);
  const [error, setError] = useState("");
  const fromRef = useRef<HTMLInputElement>(null);
  const destinationRef = useRef<HTMLInputElement>(null);

  // Required fields filled in; format checks still run on submit.
  const canSubmit =
    (isEdit || from.trim().replace(/^\/+/, "") !== "") &&
    (kind === "external" ? externalUrl.trim() : internalInput.trim()) !== "";

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setFrom(row?.from ?? "");
    setKind(row?.link.kind === "external" ? "external" : "internal");
    setInternalInput(row?.targetRoute || row?.targetPath || "");
    setResolved(
      row?.link.kind === "internal" && row.targetPath
        ? { itemId: row.link.id, name: row.targetName, path: row.targetPath }
        : undefined,
    );
    setExternalUrl(row?.link.kind === "external" ? row.link.url : "");
    setAllLanguages(false);
    setPublish(defaultPublish);
    setError("");
    setChecking(false);
    setBrowsing(false);
  }, [open, row, defaultPublish]);

  const check = async (): Promise<SitecoreItemRef | null> => {
    if (!internalInput.trim()) {
      setResolved(undefined);
      return null;
    }
    setChecking(true);
    try {
      const item = await onResolve(internalInput);
      setResolved(item);
      return item;
    } catch {
      setResolved(null);
      return null;
    } finally {
      setChecking(false);
    }
  };

  // A page picked in the tree. The Home row has no id yet, so resolve it.
  const pick = async (item: SitecoreItemRef) => {
    setBrowsing(false);
    setInternalInput(routeOf(item.path, routeRootPath) ?? item.path);
    if (item.itemId) {
      setResolved({ itemId: item.itemId, name: item.name, path: item.path });
      return;
    }
    setChecking(true);
    try {
      setResolved(await onResolve(item.path));
    } catch {
      setResolved(null);
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    setError("");

    if (!isEdit && !from.trim().replace(/^\/+/, "")) {
      setError("Enter the path to redirect from.");
      return;
    }

    if (kind === "external") {
      const url = withScheme(externalUrl);
      setExternalUrl(url);
      if (!isValidWebUrl(url)) {
        setError(
          "Enter a valid destination URL, for example www.example.com/page.",
        );
        return;
      }
      onSubmit({
        from,
        link: { kind: "external", id: "", url },
        allLanguages,
        publish,
      });
      return;
    }

    const item = resolved ?? (await check());
    if (!item) {
      setError("Choose an existing page as the destination.");
      return;
    }
    onSubmit({
      from,
      link: { kind: "internal", id: item.itemId, url: "" },
      allLanguages,
      publish,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-w-[580px] gap-5"
        onOpenAutoFocus={(event) => {
          // Put the cursor where the user types first: the From path on
          // create, the destination on edit (From is read-only there).
          const target = isEdit ? destinationRef.current : fromRef.current;
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {isEdit ? "Edit redirect" : "New redirect"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-subtle">
              <span>{siteName}</span>
              <span aria-hidden="true">·</span>
              <span>Language</span>
              <Tag>{language}</Tag>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="redirect-from" className={LABEL}>
            Old path
            {!isEdit && <Required />}
          </label>
          <div
            className={cn(
              FIELD_BOX,
              isEdit && "bg-muted shadow-none hover:border-[#cbd5e1]",
            )}
          >
            {base && (
              <span className="flex h-full max-w-[55%] items-center truncate border-r border-[#cbd5e1] bg-muted px-3 font-mono text-xs text-text-subtle">
                {displayBase(base).replace(/\/$/, "")}
              </span>
            )}
            <input
              ref={fromRef}
              id="redirect-from"
              type="text"
              value={from}
              disabled={isEdit}
              required={!isEdit}
              placeholder="e.g. /old-page"
              onChange={(event) => setFrom(event.target.value)}
              className={cn(FIELD, isEdit && "text-text-subtle")}
            />
          </div>
          <p className="text-xs text-text-subtle">
            {isEdit
              ? "The path is the item's place in the content tree and cannot be changed here."
              : "Creates a redirect item at this path. The page above it must already exist."}
            {!base &&
              " This language has no live URL yet, so the redirect can't be tested."}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={
              kind === "internal" ? "redirect-to-page" : "redirect-to-url"
            }
            className={LABEL}
          >
            Send visitors to
            <Required />
          </label>
          <div
            role="radiogroup"
            aria-label="Destination type"
            className="flex flex-wrap items-center gap-x-6 gap-y-1 py-0.5"
          >
            {(
              [
                ["internal", "Page in this site"],
                ["external", "External URL"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 text-sm text-on-surface"
              >
                <input
                  type="radio"
                  name="redirect-destination-kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="size-4 shrink-0 cursor-pointer accent-[var(--primary)] outline-none focus-visible:ring-[3px] focus-visible:ring-primary/50"
                />
                {label}
              </label>
            ))}
          </div>

          {kind === "internal" ? (
            <>
              <div className={FIELD_BOX}>
                <input
                  ref={destinationRef}
                  id="redirect-to-page"
                  type="text"
                  required
                  value={internalInput}
                  placeholder="e.g. /campaigns/new-page"
                  onChange={(event) => {
                    setInternalInput(event.target.value);
                    setResolved(undefined);
                  }}
                  onBlur={() => {
                    if (resolved === undefined) void check();
                  }}
                  className={FIELD}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="mr-1 gap-1.5"
                  disabled={checking || !treeRootPath}
                  onClick={() => setBrowsing(true)}
                >
                  <Icon path={mdiFileTreeOutline} size={0.6} />
                  Browse
                </Button>
              </div>
              <div className="flex min-h-5 items-center gap-1.5 text-xs">
                {checking && (
                  <>
                    <Icon
                      path={mdiLoading}
                      size={0.55}
                      className="animate-spin text-text-subtle"
                    />
                    <span className="text-text-subtle">Looking for the page</span>
                  </>
                )}
                {!checking && resolved && (
                  <>
                    <Icon path={mdiCheck} size={0.6} className="text-success-fg" />
                    <span className="font-semibold text-success-fg">
                      {resolved.name}
                    </span>
                    <span className="truncate font-mono text-text-subtle">
                      {resolved.path}
                    </span>
                  </>
                )}
                {!checking && resolved === null && (
                  <span className="text-danger-fg">
                    No page found at this path.
                  </span>
                )}
                {!checking && resolved === undefined && (
                  <span className="text-text-subtle">
                    Browse the content tree, or type a path below the site URL,
                    a full Sitecore path or an item ID.
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className={FIELD_BOX}>
              <input
                ref={destinationRef}
                id="redirect-to-url"
                type="url"
                required
                value={externalUrl}
                placeholder="e.g. www.example.com/page"
                onChange={(event) => setExternalUrl(event.target.value)}
                // Show the https:// we'll save as soon as the user leaves the field.
                onBlur={() => setExternalUrl((value) => withScheme(value))}
                className={FIELD}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {languageCount > 1 && (
            <label className="flex items-start gap-2.5">
              <Checkbox
                className="mt-0.5"
                checked={allLanguages}
                onChange={(event) => setAllLanguages(event.target.checked)}
              />
              <span>
                {isEdit
                  ? `Apply to all ${languageCount} languages`
                  : `Create in all ${languageCount} languages`}
                <span className="block text-xs text-text-subtle">
                  One item with a version in every language of the site, all
                  with this destination.
                </span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-2.5">
            <Checkbox
              className="mt-0.5"
              checked={publish}
              onChange={(event) => setPublish(event.target.checked)}
            />
            <span>
              Publish immediately, then test the live URL
              <span className="block text-xs text-text-subtle">
                Without this the redirect is saved but not live.
              </span>
            </span>
          </label>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-danger bg-danger-bg p-3 text-danger-fg">
            <Icon
              path={mdiAlertCircleOutline}
              size={0.75}
              className="mt-px shrink-0"
            />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={checking || !canSubmit}
            onClick={() => void submit()}
          >
            {isEdit ? "Save redirect" : "Create redirect"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <ContentTreeDialog
        open={browsing}
        rootPath={treeRootPath}
        initialPath={resolved?.path}
        onLoadChildren={onLoadChildren}
        onPick={(item) => void pick(item)}
        onClose={() => setBrowsing(false)}
      />
    </Dialog>
  );
}

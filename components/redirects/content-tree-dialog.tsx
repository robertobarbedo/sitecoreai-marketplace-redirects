"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  mdiAlertCircleOutline,
  mdiChevronRight,
  mdiFileDocumentOutline,
  mdiHomeOutline,
  mdiLoading,
} from "@mdi/js";

import { Button } from "@/components/ui/button";
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
import type { SitecoreItemRef, TreeNode } from "@/src/utils/sitecore-graphql";

type Children = TreeNode[] | "loading" | "error";

/**
 * Browse the site's content tree (from its Home item down) and pick a page as
 * the redirect destination. Children load on expand.
 */
export function ContentTreeDialog({
  open,
  rootPath,
  initialPath,
  onLoadChildren,
  onPick,
  onClose,
}: {
  open: boolean;
  /** Sitecore path of the site's Home item. */
  rootPath: string;
  /** Path of the current destination, expanded to and selected on open. */
  initialPath?: string;
  onLoadChildren: (path: string) => Promise<TreeNode[]>;
  onPick: (item: SitecoreItemRef) => void;
  onClose: () => void;
}) {
  const [children, setChildren] = useState<Record<string, Children>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<SitecoreItemRef | null>(null);

  // The parent passes a fresh loader each render; keep the latest in a ref so
  // the tree isn't rebuilt (and collapsed) every time the page re-renders.
  const loaderRef = useRef(onLoadChildren);
  loaderRef.current = onLoadChildren;

  const rootName = rootPath.split("/").filter(Boolean).pop() ?? "Home";
  const key = (path: string) => path.toLowerCase();

  const load = useCallback(
    async (path: string): Promise<TreeNode[] | null> => {
      setChildren((current) => ({ ...current, [key(path)]: "loading" }));
      try {
        const nodes = await loaderRef.current(path);
        setChildren((current) => ({ ...current, [key(path)]: nodes }));
        return nodes;
      } catch {
        setChildren((current) => ({ ...current, [key(path)]: "error" }));
        return null;
      }
    },
    [],
  );

  // Fresh tree each open: root expanded, then walk down to the current
  // destination so it is visible and selected.
  useEffect(() => {
    if (!open || !rootPath) return;
    let cancelled = false;
    setChildren({});
    setSelected(null);
    setExpanded(new Set([key(rootPath)]));

    void (async () => {
      let nodes = await load(rootPath);
      const target = initialPath ?? "";
      if (!nodes || !key(target).startsWith(`${key(rootPath)}/`)) return;

      const segments = target.slice(rootPath.length).split("/").filter(Boolean);
      for (let index = 0; index < segments.length && nodes; index++) {
        const match: TreeNode | undefined = nodes.find(
          (node) => key(node.name) === key(segments[index]),
        );
        if (!match || cancelled) return;
        if (index === segments.length - 1) {
          setSelected(match);
          return;
        }
        setExpanded((current) => new Set(current).add(key(match.path)));
        nodes = await load(match.path);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, rootPath, initialPath, load]);

  const toggle = (node: TreeNode) => {
    const nodeKey = key(node.path);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
    if (!expanded.has(nodeKey) && !Array.isArray(children[nodeKey])) {
      void load(node.path);
    }
  };

  const renderRow = (node: TreeNode, depth: number, isRoot = false) => {
    const nodeKey = key(node.path);
    const isOpen = expanded.has(nodeKey);
    const isSelected = selected?.itemId === node.itemId;
    const kids = children[nodeKey];

    return (
      <li key={node.itemId || nodeKey} role="none">
        <div
          role="treeitem"
          aria-expanded={node.hasChildren ? isOpen : undefined}
          aria-selected={isSelected}
          tabIndex={-1}
          className={cn(
            "flex min-h-9 items-center gap-1 rounded-xl pr-2 hover:bg-surface-container",
            isSelected && "bg-primary-bg hover:bg-primary-bg",
          )}
          style={{ paddingLeft: `${depth * 18 + 4}px` }}
        >
          <button
            type="button"
            aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
            disabled={!node.hasChildren}
            onClick={() => toggle(node)}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg text-on-surface-variant outline-none hover:bg-border-muted focus-visible:ring-[3px] focus-visible:ring-primary/50",
              !node.hasChildren && "invisible",
            )}
          >
            <Icon
              path={kids === "loading" ? mdiLoading : mdiChevronRight}
              size={0.65}
              className={cn(
                kids === "loading" && "animate-spin",
                kids !== "loading" && isOpen && "rotate-90",
                "transition-transform",
              )}
            />
          </button>
          <button
            type="button"
            onClick={() => setSelected(node)}
            onDoubleClick={() => onPick(node)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-primary/50"
          >
            <Icon
              path={isRoot ? mdiHomeOutline : mdiFileDocumentOutline}
              size={0.65}
              className="shrink-0 text-on-surface-variant"
            />
            <span className="truncate text-sm">{node.name}</span>
          </button>
        </div>

        {isOpen && kids === "error" && (
          <p
            className="flex items-center gap-1.5 py-1 text-xs text-danger-fg"
            style={{ paddingLeft: `${(depth + 1) * 18 + 12}px` }}
          >
            <Icon path={mdiAlertCircleOutline} size={0.55} />
            Couldn&apos;t load this level.
          </p>
        )}
        {isOpen && Array.isArray(kids) && kids.length > 0 && (
          <ul role="group">
            {kids.map((child) => renderRow(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const rootNode: TreeNode = {
    itemId: "",
    name: rootName,
    path: rootPath,
    hasChildren: true,
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[520px] gap-4">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Choose a page</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs text-text-subtle">
            {rootPath}
          </DialogDescription>
        </DialogHeader>

        <ul
          role="tree"
          aria-label="Content tree"
          className="h-[360px] overflow-y-auto rounded-xl border border-border-muted p-1"
        >
          {renderRow(rootNode, 0, true)}
        </ul>

        <p className="min-h-4 truncate font-mono text-xs text-text-subtle">
          {selected?.path ?? ""}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selected}
            onClick={() => selected && onPick(selected)}
          >
            Select page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

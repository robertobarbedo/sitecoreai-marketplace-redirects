import type { ClientSDK } from "@sitecore-marketplace-sdk/client";

import {
  DEFAULT_LANGUAGE,
  PUBLISH_WAIT_TIMEOUT_MS,
  SEARCH_MAX_PAGES,
  SEARCH_PAGE_SIZE,
} from "@/src/constants";
import type { LinkValue, RedirectRow, SiteSetup } from "@/src/types/redirects";
import { idKey } from "@/src/utils/format";
import {
  addItemVersion,
  createItem,
  deleteItem,
  getPublishStatus,
  languagesWithVersion,
  publishItem,
  queryItem,
  resolveItemsById,
  searchRedirects,
  updateItemField,
  type RawRedirect,
  type SitecoreItemRef,
} from "@/src/utils/sitecore-graphql";
import { buildLinkXml, parseLink, routeOf } from "@/src/utils/urls";

/** Everything the operations need to know about the selected site + language. */
export interface SiteContext {
  setup: SiteSetup;
  language: string;
  /** Item the redirects live under (normally the site's start item). */
  rootPath: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lists the redirects of a site in one language, destinations resolved. */
export async function loadRedirects(
  client: ClientSDK,
  contextId: string,
  site: SiteContext,
): Promise<{ rows: RedirectRow[]; truncated: boolean }> {
  // The root lookup runs in the default language: the item may have no
  // version in the language being listed.
  const root = await queryItem(
    client,
    contextId,
    site.rootPath,
    DEFAULT_LANGUAGE,
  );
  if (!root) throw new Error(`The item ${site.rootPath} does not exist.`);

  // The index holds one document per version; keep the latest of each item.
  const latest = new Map<string, RawRedirect>();
  let truncated = false;

  for (let pageIndex = 0; ; pageIndex += 1) {
    if (pageIndex >= SEARCH_MAX_PAGES) {
      truncated = true;
      break;
    }
    const page = await searchRedirects(client, contextId, {
      rootItemId: root.itemId,
      templateId: site.setup.templateId,
      fieldName: site.setup.fieldName,
      language: site.language,
      pageIndex,
    });
    for (const item of page.items) {
      const key = idKey(item.itemId);
      const known = latest.get(key);
      if (!known || item.version > known.version) latest.set(key, item);
    }
    if (
      page.rawCount < SEARCH_PAGE_SIZE ||
      (pageIndex + 1) * SEARCH_PAGE_SIZE >= page.totalCount
    ) {
      break;
    }
  }

  const raw = [...latest.values()];
  const links = raw.map((item) => parseLink(item.fieldValue));
  const targets = await resolveItemsById(
    client,
    contextId,
    links.filter((link) => link.kind === "internal").map((link) => link.id),
    site.language,
  );

  const rows = raw.map((item, index): RedirectRow => {
    const link = links[index];
    const target =
      link.kind === "internal" ? (targets.get(idKey(link.id)) ?? null) : null;
    return {
      key: `${idKey(item.itemId)}|${item.language}`,
      itemId: item.itemId,
      name: item.name,
      path: item.path,
      language: item.language,
      version: item.version,
      from: routeOf(item.path, site.rootPath) ?? item.path,
      link,
      targetPath: target?.path ?? null,
      targetName: target?.name ?? "",
      targetRoute: target ? (routeOf(target.path, site.rootPath) ?? "") : "",
      updated: item.updated,
      updatedBy: item.updatedBy,
    };
  });

  rows.sort((a, b) => a.from.localeCompare(b.from));
  return { rows, truncated };
}

/** `promo/x/`, `www.site.com/en/promo/x` → `/promo/x`. */
export function normalizeRoute(input: string, base: string): string {
  let value = input.trim().replace(/^https?:\/\//i, "");
  if (base && value.toLowerCase().startsWith(base.toLowerCase())) {
    value = value.slice(base.length);
  }
  value = value.replace(/[?#].*$/, "").replace(/\/+/g, "/").replace(/\/$/, "");
  return value.startsWith("/") ? value : `/${value}`;
}

/**
 * Finds the item behind what the author typed as a destination: an item id, a
 * full `/sitecore/...` path, or a URL path below the site (`/campaigns/x`).
 * URL paths are tried as typed and with hyphens read as spaces.
 */
export async function resolveDestination(
  client: ClientSDK,
  contextId: string,
  site: SiteContext,
  input: string,
): Promise<SitecoreItemRef | null> {
  const value = input.trim();
  if (!value) return null;

  const isId = idKey(value).length === 32 && !value.includes("/");
  if (isId || value.toLowerCase().startsWith("/sitecore/")) {
    return queryItem(client, contextId, value, site.language);
  }

  const route = normalizeRoute(value, "");
  const candidates = [
    `${site.rootPath}${route === "/" ? "" : route}`,
    `${site.rootPath}${route === "/" ? "" : route.replace(/-/g, " ")}`,
  ];
  for (const path of [...new Set(candidates)]) {
    const item = await queryItem(client, contextId, path, site.language);
    if (item) return item;
  }
  return null;
}

const ITEM_NAME = /^[A-Za-z0-9_][A-Za-z0-9 _-]*$/;

/**
 * Creates the redirect item for a URL path. The item path is the URL, so the
 * parent page must already exist; nothing is created in between.
 */
export async function createRedirectItem(
  client: ClientSDK,
  contextId: string,
  site: SiteContext,
  route: string,
): Promise<SitecoreItemRef> {
  const segments = route.split("/").filter(Boolean);
  const name = segments[segments.length - 1];
  if (!name) throw new Error("Enter the path to redirect from.");
  if (!ITEM_NAME.test(name)) {
    throw new Error(
      `"${name}" cannot be used as an item name. Use letters, numbers, hyphens and underscores.`,
    );
  }

  const parentRoute = `/${segments.slice(0, -1).join("/")}`;
  const parent = await resolveDestination(client, contextId, site, parentRoute);
  if (!parent) {
    throw new Error(
      `The page ${parentRoute} does not exist. A redirect can only be created under an existing page.`,
    );
  }

  const existing = await queryItem(
    client,
    contextId,
    `${parent.path}/${name}`,
    site.language,
  );
  if (existing) {
    throw new Error(`An item already exists at ${route}. Edit or remove it first.`);
  }

  const created = await createItem(
    client,
    contextId,
    parent.itemId,
    site.setup.templateId,
    name,
    site.language,
  );
  if (!created) throw new Error("Sitecore did not create the redirect item.");
  return created;
}

/**
 * Writes the destination into each language. A language the item has no version
 * in gets one first. Failures are collected per language instead of thrown, so
 * one bad language does not stop the others.
 */
export async function writeDestination(
  client: ClientSDK,
  contextId: string,
  site: SiteContext,
  itemId: string,
  link: LinkValue,
  languages: string[],
): Promise<Array<{ language: string; message: string }>> {
  const value = buildLinkXml(link);
  const existing = await languagesWithVersion(
    client,
    contextId,
    itemId,
    languages,
  );
  const failures: Array<{ language: string; message: string }> = [];

  for (const language of languages) {
    try {
      if (!existing.has(language)) {
        await addItemVersion(client, contextId, itemId, language);
      }
      await updateItemField(
        client,
        contextId,
        { itemId },
        site.setup.fieldName,
        value,
        language,
      );
    } catch (error) {
      failures.push({
        language,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return failures;
}

export type PublishOutcome = "done" | "unknown" | "timeout" | "cancelled";

/**
 * Publishes one item and waits for the operation. "unknown" means the status
 * query is not available in this environment, so a fixed wait was used.
 */
export async function publishAndWait(
  client: ClientSDK,
  contextId: string,
  itemPath: string,
  languages: string[],
  isCancelled: () => boolean,
): Promise<PublishOutcome> {
  const operationId = await publishItem(client, contextId, itemPath, languages);
  const started = Date.now();

  for (;;) {
    await sleep(2000);
    if (isCancelled()) return "cancelled";

    const status = await getPublishStatus(client, contextId, operationId);
    if (!status) {
      await sleep(6000);
      return "unknown";
    }
    if (status.isFailed) {
      throw new Error(`The publish failed${status.state ? ` (${status.state})` : ""}.`);
    }
    if (status.isDone) return "done";
    if (Date.now() - started > PUBLISH_WAIT_TIMEOUT_MS) return "timeout";
  }
}

/**
 * Removes a redirect. With `unpublish`, the item is first marked "never
 * publish" and published, which takes it off the live site; only then is it
 * moved to the recycle bin. Without it the live copy stays until the next
 * publish of the parent page.
 */
export async function removeRedirect(
  client: ClientSDK,
  contextId: string,
  row: RedirectRow,
  unpublish: boolean,
  languages: string[],
): Promise<void> {
  if (unpublish) {
    await updateItemField(
      client,
      contextId,
      { itemId: row.itemId },
      "__Never publish",
      "1",
      row.language,
    );
    await publishAndWait(client, contextId, row.path, languages, () => false);
  }
  const deleted = await deleteItem(client, contextId, row.itemId);
  if (!deleted) throw new Error("Sitecore refused to delete the item.");
}

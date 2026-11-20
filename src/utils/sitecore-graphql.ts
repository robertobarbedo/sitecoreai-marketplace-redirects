import type { ClientSDK } from "@sitecore-marketplace-sdk/client";

import {
  DEFAULT_LANGUAGE,
  MASTER_DATABASE,
  SEARCH_PAGE_SIZE,
} from "@/src/constants";
import { idKey } from "@/src/utils/format";

/**
 * Every authoring call in this app goes through `runAuthoring`. Queries are
 * string-interpolated (the workspace convention — the SDK passthrough takes no
 * GraphQL variables), so every interpolated value must go through
 * `escapeGraphQL` first.
 */
export function escapeGraphQL(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

type AuthoringResponse<T> = Record<string, unknown> & {
  data?: {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
};

/** Waits between attempts of a read that came back with no payload at all. */
const EMPTY_RESPONSE_RETRY_DELAYS_MS = [600, 1500];

/**
 * Best-effort text for a transport-level failure. The SDK resolves (it does not
 * throw) on a failed HTTP call, with `data: undefined` and the failure in
 * `error` — whose shape depends on what the gateway answered.
 */
function describeTransportError(response: unknown): string {
  const error = (response as { error?: unknown } | null | undefined)?.error;
  if (error === undefined || error === null || error === "") return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "detail", "title", "error"]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
    }
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json.slice(0, 300);
    } catch {
      // Not serializable — fall through to the generic message.
    }
  }
  return "";
}

/**
 * The one place that talks to the authoring endpoint. A response with neither
 * `data` nor GraphQL `errors` is a transport failure; it shows up on the first
 * calls after the app opens and clears on its own, so reads are retried.
 * Mutations are never retried: a write or publish may have gone through even
 * though the response was lost.
 */
async function requestAuthoring<T>(
  client: ClientSDK,
  sitecoreContextId: string,
  query: string,
): Promise<{ payload: AuthoringResponse<T>["data"]; transportError: string }> {
  const retryDelays = /^\s*mutation\b/.test(query)
    ? []
    : EMPTY_RESPONSE_RETRY_DELAYS_MS;

  for (let attempt = 0; ; attempt += 1) {
    let response: unknown;
    let thrown: unknown;
    try {
      response = await client.mutate("xmc.authoring.graphql", {
        params: {
          query: { sitecoreContextId },
          body: { query },
        },
      });
    } catch (error) {
      thrown = error;
    }

    const payload = (response as AuthoringResponse<T> | undefined)?.data;
    const answered =
      Boolean(payload?.errors?.length) ||
      (payload?.data !== undefined && payload?.data !== null);

    if (answered) return { payload, transportError: "" };

    if (attempt >= retryDelays.length) {
      if (thrown) throw thrown;
      return { payload, transportError: describeTransportError(response) };
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
  }
}

function emptyResponseError(transportError: string): Error {
  return new Error(
    transportError
      ? `Empty GraphQL response (${transportError})`
      : "Empty GraphQL response",
  );
}

function joinErrors(errors: Array<{ message?: string }>): string {
  return errors.map((e) => e.message ?? "Unknown GraphQL error").join("; ");
}

export async function runAuthoring<T>(
  client: ClientSDK,
  sitecoreContextId: string,
  query: string,
): Promise<T> {
  const { payload, transportError } = await requestAuthoring<T>(
    client,
    sitecoreContextId,
    query,
  );

  if (payload?.errors?.length) throw new Error(joinErrors(payload.errors));
  if (payload?.data === undefined || payload?.data === null) {
    throw emptyResponseError(transportError);
  }
  return payload.data;
}

/**
 * Like `runAuthoring`, but keeps the data when field-level errors are present.
 * Needed wherever one unresolvable item must not fail the whole request: search
 * results whose `innerItem` no longer resolves, and batched lookups by id.
 */
export async function runAuthoringPartial<T>(
  client: ClientSDK,
  sitecoreContextId: string,
  query: string,
): Promise<T> {
  const { payload, transportError } = await requestAuthoring<T>(
    client,
    sitecoreContextId,
    query,
  );

  if (payload?.data !== undefined && payload?.data !== null) return payload.data;
  if (payload?.errors?.length) throw new Error(joinErrors(payload.errors));
  throw emptyResponseError(transportError);
}

/* ------------------------------------------------------------------ context */

export interface EnvironmentContext {
  /** Stable identifier of the environment (tenant id). */
  id: string;
  /** Context id for the authoring GraphQL API (`context.preview`). */
  contextId: string;
  /** Context id the sites API wants (`context.live`) — NOT the authoring one. */
  liveContextId: string;
  label: string;
}

/**
 * The environments the host lets this app work on. Opened as Full Screen
 * inside an environment this is that one environment; opened from the
 * Standalone extension point it is every environment the app is installed on,
 * and the user picks one.
 */
export function readEnvironments(appContext: unknown): EnvironmentContext[] {
  const resourceAccess = (appContext as Record<string, unknown> | undefined)
    ?.resourceAccess as
    | Array<{
        tenantId?: string | null;
        tenantName?: string | null;
        tenantDisplayName?: string | null;
        context?: { preview?: string; live?: string };
      }>
    | undefined;

  const seen = new Set<string>();
  const environments: EnvironmentContext[] = [];
  for (const resource of resourceAccess ?? []) {
    const preview = resource?.context?.preview;
    if (!preview) continue;
    const id = resource.tenantId || preview;
    if (seen.has(id)) continue;
    seen.add(id);
    environments.push({
      id,
      contextId: preview,
      liveContextId: resource.context?.live ?? "",
      label:
        resource.tenantDisplayName || resource.tenantName || "this environment",
    });
  }
  return environments;
}

export interface SiteInfo {
  name: string;
  rootPath: string;
  /** Live hostname (`hosts[].targetHostname`); empty when unset or a wildcard. */
  targetHostname: string;
  /** Site start item relative to the root, e.g. `/Home`. */
  startItem: string;
  /** Whether the site embeds the language in the URL (`/en-ca/...`). */
  languageEmbedding: boolean;
  /** Languages in use by the site; empty when the API does not report them. */
  languages: string[];
}

/** Sites of the environment; the sites API needs the LIVE context id. */
export async function listSites(
  client: ClientSDK,
  liveContextId: string,
): Promise<SiteInfo[]> {
  if (!liveContextId) return [];

  const response = await client.query("xmc.xmapp.listSites", {
    params: { query: { sitecoreContextId: liveContextId } },
  });

  const sites = (
    response as {
      data?: {
        data?: Array<{
          name?: string;
          languages?: string[] | null;
          properties?: { rootPath?: string };
          hosts?: Array<{
            targetHostname?: string;
            properties?: { startItem?: string };
            languageSettings?: { languageEmbedding?: boolean };
          }>;
        }>;
      };
    }
  ).data?.data;

  return (sites ?? [])
    .filter((site) => site.name && site.properties?.rootPath)
    .map((site) => {
      const host = site.hosts?.[0];
      const hostname = host?.targetHostname ?? "";
      const startItem = host?.properties?.startItem || "/Home";

      return {
        name: site.name as string,
        rootPath: site.properties?.rootPath as string,
        targetHostname: hostname.includes("*") ? "" : hostname,
        startItem: startItem.startsWith("/") ? startItem : `/${startItem}`,
        languageEmbedding: Boolean(host?.languageSettings?.languageEmbedding),
        languages: (site.languages ?? []).filter(
          (language): language is string => typeof language === "string",
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------- items */

export interface SitecoreItemRef {
  itemId: string;
  name: string;
  path: string;
}

/** `where` lookup key: a GUID is sent as `itemId`, anything else as `path`. */
function itemLocator(idOrPath: string): string {
  const value = idOrPath.trim();
  return idKey(value).length === 32 && !value.includes("/")
    ? `itemId: "${escapeGraphQL(value)}"`
    : `path: "${escapeGraphQL(value)}"`;
}

/** Item by path or id, or null when it does not exist in that language. */
export async function queryItem(
  client: ClientSDK,
  sitecoreContextId: string,
  idOrPath: string,
  language: string,
): Promise<SitecoreItemRef | null> {
  const data = await runAuthoring<{ item?: SitecoreItemRef | null }>(
    client,
    sitecoreContextId,
    `
      query {
        item(where: {
          database: "${MASTER_DATABASE}"
          ${itemLocator(idOrPath)}
          language: "${escapeGraphQL(language)}"
        }) {
          itemId
          name
          path
        }
      }
    `,
  );
  return data.item?.itemId ? data.item : null;
}

export interface TreeNode extends SitecoreItemRef {
  hasChildren: boolean;
}

/**
 * Direct children of an item, for the content tree picker. Same
 * `children { nodes { … hasChildren } }` shape the publishing-center tree uses.
 */
export async function listChildren(
  client: ClientSDK,
  sitecoreContextId: string,
  idOrPath: string,
  language: string,
): Promise<TreeNode[]> {
  const data = await runAuthoring<{
    item?: { children?: { nodes?: TreeNode[] | null } | null } | null;
  }>(
    client,
    sitecoreContextId,
    `
      query {
        item(where: {
          database: "${MASTER_DATABASE}"
          ${itemLocator(idOrPath)}
          language: "${escapeGraphQL(language)}"
        }) {
          children {
            nodes {
              itemId
              name
              path
              hasChildren
            }
          }
        }
      }
    `,
  );
  return (data.item?.children?.nodes ?? []).filter((node) => node?.itemId);
}

/** One field's raw value off an item, or null when the item doesn't exist. */
export async function getItemFieldValue(
  client: ClientSDK,
  sitecoreContextId: string,
  path: string,
  fieldName: string,
  language: string,
): Promise<string | null> {
  const data = await runAuthoring<{
    item?: { field?: { value?: string | null } | null } | null;
  }>(
    client,
    sitecoreContextId,
    `
      query {
        item(where: {
          database: "${MASTER_DATABASE}"
          path: "${escapeGraphQL(path)}"
          language: "${escapeGraphQL(language)}"
        }) {
          field(name: "${escapeGraphQL(fieldName)}") { value }
        }
      }
    `,
  );
  return data.item?.field?.value ?? null;
}

export async function createItem(
  client: ClientSDK,
  sitecoreContextId: string,
  parentId: string,
  templateId: string,
  itemName: string,
  language: string,
): Promise<SitecoreItemRef | null> {
  const data = await runAuthoring<{
    createItem?: { item?: SitecoreItemRef | null } | null;
  }>(
    client,
    sitecoreContextId,
    `
      mutation {
        createItem(input: {
          database: "${MASTER_DATABASE}"
          name: "${escapeGraphQL(itemName)}"
          parent: "${escapeGraphQL(parentId)}"
          templateId: "${escapeGraphQL(templateId)}"
          language: "${escapeGraphQL(language)}"
        }) {
          item { itemId name path }
        }
      }
    `,
  );
  return data.createItem?.item ?? null;
}

/**
 * Writes one field. `path` and `version` are optional: the settings item passes
 * both (the shape the sibling apps use); redirect items pass only the id so the
 * latest version of the language is updated.
 */
export async function updateItemField(
  client: ClientSDK,
  sitecoreContextId: string,
  target: { itemId: string; path?: string; version?: number },
  fieldName: string,
  fieldValue: string,
  language: string,
): Promise<void> {
  await runAuthoring<{ updateItem?: unknown }>(
    client,
    sitecoreContextId,
    `
      mutation {
        updateItem(input: {
          fields: [
            {
              name: "${escapeGraphQL(fieldName)}",
              value: "${escapeGraphQL(fieldValue)}",
              reset: false
            }
          ]
          database: "${MASTER_DATABASE}"
          itemId: "${escapeGraphQL(target.itemId)}"
          language: "${escapeGraphQL(language)}"
          ${target.path ? `path: "${escapeGraphQL(target.path)}"` : ""}
          ${target.version ? `version: ${Math.trunc(Number(target.version)) || 1}` : ""}
        }) {
          item { itemId }
        }
      }
    `,
  );
}

/** Adds a version of the item in `language` (used for "all languages"). */
export async function addItemVersion(
  client: ClientSDK,
  sitecoreContextId: string,
  itemId: string,
  language: string,
): Promise<void> {
  await runAuthoring<{ addItemVersion?: unknown }>(
    client,
    sitecoreContextId,
    `
      mutation {
        addItemVersion(input: {
          database: "${MASTER_DATABASE}"
          itemId: "${escapeGraphQL(itemId)}"
          language: "${escapeGraphQL(language)}"
        }) {
          item { itemId }
        }
      }
    `,
  );
}

/**
 * Which of `languages` the item already has a version in. A language without a
 * version resolves to null or version 0; a failed lookup counts as "no version".
 */
export async function languagesWithVersion(
  client: ClientSDK,
  sitecoreContextId: string,
  itemId: string,
  languages: string[],
): Promise<Set<string>> {
  if (languages.length === 0) return new Set();

  const selections = languages
    .map(
      (language, index) => `
        l${index}: item(where: {
          database: "${MASTER_DATABASE}"
          itemId: "${escapeGraphQL(itemId)}"
          language: "${escapeGraphQL(language)}"
        }) { version }
      `,
    )
    .join("\n");

  const found = new Set<string>();
  try {
    const data = await runAuthoringPartial<
      Record<string, { version?: number | null } | null>
    >(client, sitecoreContextId, `query { ${selections} }`);
    languages.forEach((language, index) => {
      if ((data[`l${index}`]?.version ?? 0) > 0) found.add(language);
    });
  } catch {
    // Treated as "no versions": the caller then tries to add them.
  }
  return found;
}

/** Moves the item to the recycle bin. */
export async function deleteItem(
  client: ClientSDK,
  sitecoreContextId: string,
  itemId: string,
): Promise<boolean> {
  const data = await runAuthoring<{
    deleteItem?: { successful?: boolean } | null;
  }>(
    client,
    sitecoreContextId,
    `
      mutation {
        deleteItem(input: {
          database: "${MASTER_DATABASE}"
          itemId: "${escapeGraphQL(itemId)}"
          permanently: false
        }) {
          successful
        }
      }
    `,
  );
  return data.deleteItem?.successful ?? false;
}

/* ------------------------------------------------------------------ redirects */

export interface RawRedirect {
  itemId: string;
  name: string;
  path: string;
  language: string;
  version: number;
  fieldValue: string;
  updated: string;
  updatedBy: string;
}

interface SearchInnerItem {
  itemId?: string;
  name?: string;
  path?: string;
  version?: number;
  language?: { name?: string };
  target?: { value?: string | null } | null;
  updated?: { value?: string | null } | null;
  updatedBy?: { value?: string | null } | null;
}

/**
 * One page of redirect items: everything under `rootItemId` that is based on
 * `templateId`, in one language. The index only enumerates; field values are
 * read off `innerItem`, i.e. live from the database.
 */
export async function searchRedirects(
  client: ClientSDK,
  sitecoreContextId: string,
  options: {
    rootItemId: string;
    templateId: string;
    fieldName: string;
    language: string;
    pageIndex: number;
  },
): Promise<{ totalCount: number; rawCount: number; items: RawRedirect[] }> {
  const { rootItemId, templateId, fieldName, language, pageIndex } = options;

  const data = await runAuthoringPartial<{
    search?: {
      totalCount?: number;
      results?: Array<{ innerItem?: SearchInnerItem | null }>;
    } | null;
  }>(
    client,
    sitecoreContextId,
    `
      query {
        search(query: {
          index: "sitecore_master_index"
          searchStatement: { criteria: [
            { operator: MUST, field: "_path", value: "${escapeGraphQL(idKey(rootItemId))}" }
            { operator: MUST, field: "_templates", value: "${escapeGraphQL(idKey(templateId))}" }
            { operator: MUST, field: "_language", value: "${escapeGraphQL(language)}" }
          ] }
          paging: { pageSize: ${SEARCH_PAGE_SIZE}, pageIndex: ${pageIndex} }
        }) {
          totalCount
          results {
            innerItem {
              itemId
              name
              path
              version
              language { name }
              target: field(name: "${escapeGraphQL(fieldName)}") { value }
              updated: field(name: "__Updated") { value }
              updatedBy: field(name: "__Updated by") { value }
            }
          }
        }
      }
    `,
  );

  if (!data.search) throw new Error("The search query returned no result set");

  const results = data.search.results ?? [];
  const items: RawRedirect[] = [];
  for (const result of results) {
    const inner = result.innerItem;
    if (!inner?.itemId || !inner.path) continue;
    items.push({
      itemId: inner.itemId,
      name: inner.name ?? "",
      path: inner.path,
      language: inner.language?.name || language,
      version: inner.version ?? 1,
      fieldValue: inner.target?.value ?? "",
      updated: inner.updated?.value ?? "",
      updatedBy: inner.updatedBy?.value ?? "",
    });
  }

  return {
    totalCount: data.search.totalCount ?? 0,
    rawCount: results.length,
    items,
  };
}

/**
 * Looks up many items by id in one request per 40 ids. The result maps
 * `idKey(id)` to the item, or to null when it no longer exists.
 */
export async function resolveItemsById(
  client: ClientSDK,
  sitecoreContextId: string,
  ids: string[],
  language: string,
): Promise<Map<string, SitecoreItemRef | null>> {
  const resolved = new Map<string, SitecoreItemRef | null>();
  // Only bare 32-hex GUIDs: these ids come from authored link fields and are
  // put into the query unescaped.
  const unique = [...new Set(ids.map(idKey))].filter((id) =>
    /^[0-9a-f]{32}$/.test(id),
  );

  for (let start = 0; start < unique.length; start += 40) {
    const chunk = unique.slice(start, start + 40);
    const selections = chunk
      .map(
        (id, index) => `
          i${index}: item(where: {
            database: "${MASTER_DATABASE}"
            itemId: "${id}"
            language: "${escapeGraphQL(language)}"
          }) { itemId name path }
        `,
      )
      .join("\n");

    const data = await runAuthoringPartial<
      Record<string, SitecoreItemRef | null>
    >(client, sitecoreContextId, `query { ${selections} }`);

    chunk.forEach((id, index) => {
      const item = data[`i${index}`];
      resolved.set(id, item?.itemId ? item : null);
    });
  }
  return resolved;
}

/* ---------------------------------------------------------------- publishing */

/** Smart-publishes a single item (no sub-items, no related items) to Edge. */
export async function publishItem(
  client: ClientSDK,
  sitecoreContextId: string,
  itemPath: string,
  languages: string[],
): Promise<string> {
  const langList = languages.map((l) => `"${escapeGraphQL(l)}"`).join(", ");

  const data = await runAuthoring<{
    publishItem?: { operationId?: string } | null;
  }>(
    client,
    sitecoreContextId,
    `
      mutation {
        publishItem(input: {
          rootItemPath: "${escapeGraphQL(itemPath)}"
          languages: [${langList}]
          targetDatabases: "experienceedge"
          publishItemMode: SMART
          publishRelatedItems: false
          publishSubItems: false
        }) {
          operationId
        }
      }
    `,
  );

  const operationId = data.publishItem?.operationId;
  if (!operationId) throw new Error("No publish operation id returned");
  return operationId;
}

export interface PublishStatus {
  isDone: boolean;
  isFailed: boolean;
  state: string;
}

/**
 * Status of a publish operation, or null when the status query is not
 * available — the caller then waits a fixed time instead.
 */
export async function getPublishStatus(
  client: ClientSDK,
  sitecoreContextId: string,
  operationId: string,
): Promise<PublishStatus | null> {
  try {
    const data = await runAuthoring<{
      publishingStatus?: {
        isDone?: boolean;
        isFailed?: boolean;
        state?: string | null;
      } | null;
    }>(
      client,
      sitecoreContextId,
      `
        query {
          publishingStatus(publishingOperationId: "${escapeGraphQL(operationId)}") {
            isDone
            isFailed
            state
          }
        }
      `,
    );
    const status = data.publishingStatus;
    if (!status) return null;
    return {
      isDone: Boolean(status.isDone),
      isFailed: Boolean(status.isFailed),
      state: status.state ?? "",
    };
  } catch {
    return null;
  }
}

export { DEFAULT_LANGUAGE };

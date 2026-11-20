import type { ClientSDK } from "@sitecore-marketplace-sdk/client";

import {
  DEFAULT_LANGUAGE,
  MARKETPLACE_FOLDER_NAME,
  MODULE_FOLDER_NAME,
  MODULES_PARENT_ID,
  SETTINGS_ITEM_NAME,
  SETTINGS_PATHS,
  SITECORE_TEMPLATES,
  SXA_REDIRECT_TEMPLATE,
} from "@/src/constants";
import type {
  RedirectSettings,
  SiteSetup,
  VercelBypass,
} from "@/src/types/redirects";
import { idKey } from "@/src/utils/format";
import {
  createItem,
  getItemFieldValue,
  queryItem,
  updateItemField,
} from "@/src/utils/sitecore-graphql";

/**
 * Admin settings live in the content tree at
 * `/sitecore/system/Modules/Marketplace/Redirect Manager/Settings` (JSON in the
 * `Value` field), following the sibling apps' convention. A site without an
 * entry uses the standard SXA redirect template.
 */
export const DEFAULT_SETTINGS: RedirectSettings = {
  version: 1,
  sites: {},
  updatedAt: "",
};

export const DEFAULT_SITE_SETUP: SiteSetup = {
  templateId: SXA_REDIRECT_TEMPLATE.id,
  templatePath: SXA_REDIRECT_TEMPLATE.path,
  templateName: SXA_REDIRECT_TEMPLATE.name,
  fieldName: SXA_REDIRECT_TEMPLATE.field,
  rootPath: "",
  urls: {},
  publishOnSave: true,
  vercelBypass: null,
};

/** The stored setup of a site merged over the SXA defaults. */
export function getSiteSetup(
  settings: RedirectSettings,
  siteName: string,
): SiteSetup {
  const stored = settings.sites[siteName] ?? {};
  return {
    ...DEFAULT_SITE_SETUP,
    ...stored,
    templateId: stored.templateId || DEFAULT_SITE_SETUP.templateId,
    fieldName: stored.fieldName || DEFAULT_SITE_SETUP.fieldName,
    urls: { ...(stored.urls ?? {}) },
    vercelBypass: isVercelBypass(stored.vercelBypass)
      ? stored.vercelBypass
      : null,
  };
}

function isVercelBypass(value: unknown): value is VercelBypass {
  const candidate = value as Partial<VercelBypass> | null | undefined;
  return (
    typeof candidate?.sealed === "string" &&
    Array.isArray(candidate.hosts) &&
    candidate.hosts.every((host) => typeof host === "string")
  );
}

/** True when the site still reads redirects from the standard SXA template. */
export function usesSxaDefault(setup: SiteSetup): boolean {
  return (
    idKey(setup.templateId) === idKey(SXA_REDIRECT_TEMPLATE.id) &&
    setup.fieldName.toLowerCase() === SXA_REDIRECT_TEMPLATE.field.toLowerCase()
  );
}

/** Loads the settings item; defaults when absent, unreadable, or unparsable. */
export async function loadSettings(
  client: ClientSDK,
  sitecoreContextId: string,
): Promise<RedirectSettings> {
  try {
    const raw = await getItemFieldValue(
      client,
      sitecoreContextId,
      SETTINGS_PATHS.SETTINGS_ITEM,
      "Value",
      DEFAULT_LANGUAGE,
    );
    if (!raw) return { ...DEFAULT_SETTINGS };

    const parsed = JSON.parse(raw) as Partial<RedirectSettings>;
    const sites =
      parsed.sites && typeof parsed.sites === "object" ? parsed.sites : {};
    return { ...DEFAULT_SETTINGS, ...parsed, version: 1, sites };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Ensures a folder item exists, creating it under `parentId` if missing. */
async function ensureFolder(
  client: ClientSDK,
  sitecoreContextId: string,
  path: string,
  parentId: string,
  name: string,
) {
  const existing = await queryItem(
    client,
    sitecoreContextId,
    path,
    DEFAULT_LANGUAGE,
  );
  if (existing) return existing;

  const created = await createItem(
    client,
    sitecoreContextId,
    parentId,
    SITECORE_TEMPLATES.MODULE_FOLDER,
    name,
    DEFAULT_LANGUAGE,
  );
  if (!created) throw new Error(`Failed to create the ${name} folder`);
  return created;
}

/**
 * Writes the settings, creating the folder chain and the Settings item on first
 * save. Throws when the user cannot write under `/sitecore/system/Modules` —
 * the caller surfaces that as a toast.
 */
export async function saveSettings(
  client: ClientSDK,
  sitecoreContextId: string,
  settings: RedirectSettings,
): Promise<RedirectSettings> {
  const marketplaceFolder = await ensureFolder(
    client,
    sitecoreContextId,
    SETTINGS_PATHS.MARKETPLACE_FOLDER,
    MODULES_PARENT_ID,
    MARKETPLACE_FOLDER_NAME,
  );
  const moduleFolder = await ensureFolder(
    client,
    sitecoreContextId,
    SETTINGS_PATHS.MODULE_FOLDER,
    marketplaceFolder.itemId,
    MODULE_FOLDER_NAME,
  );

  let settingsItem = await queryItem(
    client,
    sitecoreContextId,
    SETTINGS_PATHS.SETTINGS_ITEM,
    DEFAULT_LANGUAGE,
  );
  if (!settingsItem) {
    settingsItem = await createItem(
      client,
      sitecoreContextId,
      moduleFolder.itemId,
      SITECORE_TEMPLATES.SETTINGS_ITEM,
      SETTINGS_ITEM_NAME,
      DEFAULT_LANGUAGE,
    );
    if (!settingsItem) throw new Error("Failed to create the Settings item");
  }

  const value: RedirectSettings = {
    ...settings,
    version: 1,
    updatedAt: new Date().toISOString(),
  };

  await updateItemField(
    client,
    sitecoreContextId,
    {
      itemId: settingsItem.itemId,
      path: SETTINGS_PATHS.SETTINGS_ITEM,
      version: 1,
    },
    "Value",
    JSON.stringify(value),
    DEFAULT_LANGUAGE,
  );

  return value;
}

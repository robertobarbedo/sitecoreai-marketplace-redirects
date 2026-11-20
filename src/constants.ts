/** Item paths and tuning constants for the Redirect Manager app. */

/** Redirect items only exist (and are edited) in the authoring database. */
export const MASTER_DATABASE = "master";

export const DEFAULT_LANGUAGE = "en";

/**
 * The standard SXA redirect template and its General Link field. Every site
 * starts on these; Settings can point a site at its own template instead.
 */
export const SXA_REDIRECT_TEMPLATE = {
  id: "{C14B6289-8AC2-439C-9E5B-40DE9F820C3F}",
  path: "/sitecore/templates/Foundation/Experience Accelerator/Redirects/Redirect",
  name: "Redirect",
  field: "RedirectUrl",
} as const;

/** Documents requested per `search` call while listing redirects. */
export const SEARCH_PAGE_SIZE = 200;

/** Safety cap on one listing (25 × 200 = 5,000 index documents). */
export const SEARCH_MAX_PAGES = 25;

/** Rows per table page. */
export const ROW_PAGE_SIZE = 25;

/** Redirects tested at the same time during "Test all". */
export const TEST_CONCURRENCY = 3;

/**
 * Waits before each live test after a publish. The first attempts can fail
 * while Experience Edge and the site's cache catch up, so the test is repeated.
 */
export const PUBLISH_TEST_DELAYS_MS = [3000, 5000, 8000, 12000, 15000];

/** How long to wait for a publish operation before testing anyway. */
export const PUBLISH_WAIT_TIMEOUT_MS = 90_000;

/** localStorage key holding the per-user view preferences. */
export const PREFS_STORAGE_KEY = "sitecoreai-redirect-manager-prefs";

/* ------------------------------------------------------- settings storage */

/** Well-known template ids used when creating the settings items. */
export const SITECORE_TEMPLATES = {
  MODULE_FOLDER: "{A87A00B1-E6DB-45AB-8B54-636FEC3B5523}",
  SETTINGS_ITEM: "{D2923FEE-DA4E-49BE-830C-E27764DFA269}",
} as const;

/** `/sitecore/system/Modules` — parent of the Marketplace folder. */
export const MODULES_PARENT_ID = "{08477468-D438-43D4-9D6A-6D84A611971C}";

/** Content tree paths where this app persists its admin settings. */
export const SETTINGS_PATHS = {
  MARKETPLACE_FOLDER: "/sitecore/system/Modules/Marketplace",
  MODULE_FOLDER: "/sitecore/system/Modules/Marketplace/Redirect Manager",
  SETTINGS_ITEM: "/sitecore/system/Modules/Marketplace/Redirect Manager/Settings",
} as const;

export const MARKETPLACE_FOLDER_NAME = "Marketplace";
export const MODULE_FOLDER_NAME = "Redirect Manager";
export const SETTINGS_ITEM_NAME = "Settings";

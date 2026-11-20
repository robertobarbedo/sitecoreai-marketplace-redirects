/** How one site stores its redirects. Everything is optional in storage. */
export interface SiteSetup {
  /** Template id of the redirect items. */
  templateId: string;
  /** Template path, kept only for display. */
  templatePath: string;
  templateName: string;
  /** Name of the General Link field holding the destination. */
  fieldName: string;
  /** Item the redirects live under; "" = the site's start item. */
  rootPath: string;
  /** Live URL per language (`www.example.com/pt`), overriding the detected one. */
  urls: Record<string, string>;
  /** Default of the "Publish immediately" checkbox. */
  publishOnSave: boolean;
  /** Vercel Protection Bypass for Automation secret, sealed on the server. */
  vercelBypass: VercelBypass | null;
}

/**
 * A sealed Vercel bypass secret. `hosts` is part of the seal: the server only
 * opens it for these hosts and only sends it to them.
 */
export interface VercelBypass {
  sealed: string;
  hosts: string[];
}

/** Admin settings, stored as JSON in the Settings item. */
export interface RedirectSettings {
  version: 1;
  /** Keyed by site name; a missing site uses the SXA defaults. */
  sites: Record<string, Partial<SiteSetup>>;
  updatedAt: string;
}

/** One selectable row of the site picker: a site in one language. */
export interface SiteUrl {
  siteName: string;
  language: string;
  /** Host plus language prefix, no scheme, no trailing slash. "" = unknown. */
  base: string;
}

export type LinkKind = "internal" | "external" | "empty" | "other";

/** A parsed General Link field value. */
export interface LinkValue {
  kind: LinkKind;
  /** Target item id (internal links). */
  id: string;
  /** Target URL (external links). */
  url: string;
}

export interface RedirectRow {
  /** `itemId|language`. */
  key: string;
  itemId: string;
  name: string;
  path: string;
  language: string;
  version: number;
  /** URL path below the site URL, e.g. `/promo/summer-sale`. */
  from: string;
  link: LinkValue;
  /** Internal destination: item path, or null when the item no longer exists. */
  targetPath: string | null;
  targetName: string;
  /** Destination as a URL path below the site URL ("" when it is elsewhere). */
  targetRoute: string;
  updated: string;
  updatedBy: string;
}

export type TestLevel = "working" | "warning" | "broken" | "error";

export interface TestHop {
  status: number;
  url: string;
}

export interface TestResult {
  level: TestLevel;
  /** Short reason shown under the badge. */
  note: string;
  /** Longer explanation for the details panel. */
  detail: string;
  hops: TestHop[];
}

/** Row test state: a result, or a marker while a test is pending. */
export type TestState = TestResult | "queued" | "running";

/** What the editor dialog hands back to the page. */
export interface RedirectDraft {
  /** URL path, e.g. `/promo/black-friday` (new redirects only). */
  from: string;
  link: LinkValue;
  allLanguages: boolean;
  publish: boolean;
}

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface ProgressStep {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
}

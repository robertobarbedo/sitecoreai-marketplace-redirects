import type { LinkValue, SiteSetup, SiteUrl } from "@/src/types/redirects";
import type { SiteInfo } from "@/src/utils/sitecore-graphql";

/** `https://x/en/`, `//x/en`, whitespace → `x/en` (host plus prefix). */
export function cleanBase(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/** How a base is shown: a bare host gets a trailing slash (`www.example.com/`). */
export function displayBase(base: string): string {
  if (!base) return "No live URL";
  return base.includes("/") ? base : `${base}/`;
}

/** The URL the site reports for a language, before any override. */
export function detectedBase(site: SiteInfo, language: string): string {
  if (!site.targetHostname) return "";
  const host = cleanBase(site.targetHostname);
  return site.languageEmbedding ? `${host}/${language.toLowerCase()}` : host;
}

/** Languages a site is offered in; falls back to `fallback` when unreported. */
export function siteLanguages(site: SiteInfo, fallback: string): string[] {
  return site.languages.length > 0 ? site.languages : [fallback];
}

/** The picker rows of one site: one live URL per language. */
export function siteUrls(
  site: SiteInfo,
  setup: SiteSetup,
  fallbackLanguage: string,
): SiteUrl[] {
  return siteLanguages(site, fallbackLanguage).map((language) => ({
    siteName: site.name,
    language,
    base: cleanBase(setup.urls[language] ?? "") || detectedBase(site, language),
  }));
}

/** Item the redirects of a site live under (the start item unless overridden). */
export function redirectsRootPath(site: SiteInfo, setup: SiteSetup): string {
  const custom = setup.rootPath.trim().replace(/\/+$/, "");
  return custom || `${site.rootPath}${site.startItem}`;
}

/**
 * URL path of an item below the root: lower case, spaces as hyphens (the
 * SitecoreAI default link encoding). Returns null when the item is elsewhere.
 */
export function routeOf(itemPath: string, rootPath: string): string | null {
  const lowerItem = itemPath.toLowerCase();
  const lowerRoot = rootPath.toLowerCase();
  if (lowerItem === lowerRoot) return "/";
  if (!lowerItem.startsWith(`${lowerRoot}/`)) return null;
  return itemPath.slice(rootPath.length).toLowerCase().replace(/ /g, "-");
}

/**
 * Distinct hosts of a site's live URLs across its languages — the only hosts
 * a Vercel bypass secret is sealed for and sent to.
 */
export function siteHosts(
  site: SiteInfo,
  setup: SiteSetup,
  fallbackLanguage: string,
): string[] {
  const hosts = siteUrls(site, setup, fallbackLanguage)
    .map((row) => row.base.split("/")[0].split(":")[0].toLowerCase())
    .filter(Boolean);
  return [...new Set(hosts)].sort();
}

/** True when two host lists hold the same hosts (order and case ignored). */
export function sameHosts(a: string[], b: string[]): boolean {
  const left = [...new Set(a.map((host) => host.toLowerCase()))].sort();
  const right = [...new Set(b.map((host) => host.toLowerCase()))].sort();
  return left.length === right.length && left.every((host, i) => host === right[i]);
}

export function fullUrl(base: string, route: string): string {
  return `https://${base}${route === "/" ? "" : route}`;
}

/* -------------------------------------------------------------- link field */

function attribute(xml: string, name: string): string {
  const match = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(xml);
  if (!match) return "";
  return match[1]
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Parses a General Link field value (`<link linktype="internal" id="{...}" />`). */
export function parseLink(raw: string): LinkValue {
  const value = raw.trim();
  if (!value) return { kind: "empty", id: "", url: "" };

  // A plain URL or path in a text field is treated as an external destination.
  if (!value.startsWith("<")) return { kind: "external", id: "", url: value };

  const linkType = attribute(value, "linktype").toLowerCase();
  const id = attribute(value, "id");
  const url = attribute(value, "url");

  if (linkType === "internal" && id) return { kind: "internal", id, url: "" };
  if (linkType === "external" && url) return { kind: "external", id: "", url };
  if (!linkType && id) return { kind: "internal", id, url: "" };
  if (!linkType && url) return { kind: "external", id: "", url };
  return { kind: id || url ? "other" : "empty", id, url };
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bracedUpperGuid(id: string): string {
  const key = id.replace(/[{}-]/g, "").toUpperCase();
  if (key.length !== 32) return id;
  return `{${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}}`;
}

/** Builds the General Link field value for a destination. */
export function buildLinkXml(link: LinkValue): string {
  if (link.kind === "internal") {
    return `<link text="" anchor="" linktype="internal" class="" title="" target="" querystring="" id="${bracedUpperGuid(link.id)}" />`;
  }
  if (link.kind === "external") {
    return `<link text="" linktype="external" url="${escapeAttribute(link.url)}" anchor="" target="" />`;
  }
  return "";
}

/** Comparable form of a URL: no scheme, query or hash, lower case, no trailing slash. */
export function comparableUrl(url: string): string {
  return url
    .replace(/[?#].*$/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

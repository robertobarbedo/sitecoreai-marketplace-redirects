# Redirect Manager — notes for Claude Code

## Do NOT run or test this app standalone

SitecoreAI Marketplace apps **cannot run as standalone web apps**. The
Marketplace SDK (`ClientSDK.init({ target: window.parent })`) requires the app to
be embedded in an iframe inside SitecoreAI. **Do not start the dev server, open
the app in a browser, or attempt runtime testing.** Verification is limited to:

- `npm run build` (type-check + lint + compile) must pass. If the user has
  `next dev` running in this folder (check first), do NOT build or delete
  `.next` — it breaks their server; use `npx tsc --noEmit` and `npx eslint`.
- Manual testing happens only inside SitecoreAI after the app is registered in
  App Studio (**Full Screen** extension point → the root route `/`).

## What it does

Authors manage SXA redirect items per site and language: list, create, edit,
delete, publish, and **test** them against the live site.

An SXA redirect is an item whose **path is the URL** (`Home/promo/x` answers
`/promo/x`) and whose General Link field says where to go. Defaults for every
site: template
`/sitecore/templates/Foundation/Experience Accelerator/Redirects/Redirect`
(`{C14B6289-8AC2-439C-9E5B-40DE9F820C3F}`), field `RedirectUrl`. Settings (cog)
can point a site at its own template/field.

Extension points: **Full Screen** (inside an environment) and **Standalone**
(from the Cloud Portal). `readEnvironments` lists `resourceAccess`: one entry
means the app just uses it and shows no selector; several mean the quiet
"ENVIRONMENT name" line above the header (`environment-picker.tsx`) is shown.
First open with several and none remembered shows "Choose an environment";
the choice is remembered per user. Switching clears everything on screen and
reloads sites and settings (`switchEnvironment`). The line sits outside the app
header on purpose, so the same pattern is reused in the other apps.

## UI decisions (agreed with the user — keep)

- Site setup (Settings) is tabbed per site: **General** (template, field,
  root, live URLs, publish default) and **Vercel** (bypass secret).
- No top-level tabs on the main screen. The cog (top right) opens Settings; each site heading in the picker
  has its own cog that opens that site's setup.
- Site + language is ONE grouped dropdown (`site-picker.tsx`): site name is a
  non-selectable heading, the rows are the live URLs with a language tag. URLs
  are shown **without** `//` or scheme (`www.example.com/pt`). Search
  placeholder is `Find...`.
- New/Edit dialog: destination type is a real radio pair ("Page in this
  site" / "External URL"), not a segmented toggle. The internal field has a
  **Browse** button (content tree) instead of "Check".
- No status column. A **Test** button per row and **Test all** instead.
- New/Edit dialog shows the language in context and offers "all languages":
  one item, a version per site language, the same destination everywhere — no
  per-language values (sites can have 30+ languages).
- "Publish immediately, then test the live URL" opens the progress dialog:
  save → other languages → publish → up to 5 test attempts
  (`PUBLISH_TEST_DELAYS_MS`), since the first can fail on cache. It updates
  live and can be closed at any time; closing only skips the remaining test
  attempts — the save and publish still complete.

## The test

`testRedirect` (`src/utils/redirect-test.ts`): Sitecore data first (empty
field, missing destination item), then `POST /api/test`, which follows the live
URL hop by hop and returns status codes + URLs only.

- Working: one redirect, final page 2xx, ends on the configured destination.
- Warning: more than one redirect (chain), or ends on another URL.
- Broken: first hop is not a 3xx (404 ⇒ probably unpublished), final page
  4xx/5xx, loop, more than 8 hops, destination item missing/empty.
- `error` level = the test could not run (no live URL, sign-in not configured).
  It is not retried and not counted as broken.

Results live in page state only (per session, cleared when site/language
changes).

## Security

- `/api/test` makes server-side requests to user-influenced URLs, so:
  `src/middleware.ts` requires a signed-in Sitecore user for every `/api/*`
  route (marketplace-auth kit, copied unchanged from `webhooks`), and every
  hop goes through `src/utils/ssrfGuard.ts` (shared file — keep identical
  across apps): https only, default port, public addresses only, DNS-pinned.
- The route never returns headers or bodies, only `{ status, url }` per hop.
- Needs `NEXT_PUBLIC_AUTH0_CLIENT_ID` / `NEXT_PUBLIC_SITECORE_APP_ID`
  (`.env.example`). Without them everything except Test still works.
  `SECRET_ENCRYPTION_KEY` is needed only to save a Vercel bypass secret.
  For local sign-in, `npm run dev:https` serves https://localhost:5014
  (Next's mkcert certs in `/certificates`, git-ignored) in case the Cloud
  Portal won't accept an http callback URL.
- **Vercel bypass secret** (site Settings → Vercel tab): the Protection
  Bypass for Automation secret, for sites behind Vercel Deployment Protection.
  Password Protection passwords are NOT supported (Vercel has no documented
  server-side login; the user chose bypass-secret-only on 2026-11-15 — a
  bypass secret also gets past the password). `POST /api/vercel-secret`
  seals it (`src/lib/secret-crypto.ts`, AES-256-GCM, key from
  `SECRET_ENCRYPTION_KEY`, no plaintext fallback) bound to the caller's
  `org_id` AND the site's live-URL hosts; stored as
  `vercelBypass: { sealed, hosts }` in the site setup. `/api/test` opens it
  and sends the `x-vercel-protection-bypass` HEADER only on hops whose host
  is in that list (never to external destinations; never the query param or
  `x-vercel-set-bypass-cookie`, which redirects and strips it). Changing a
  site's hosts breaks the seal → re-enter (the tab warns). A first hop of
  401/403 is reported as "site asks for a login".
- No other secrets are stored. No analytics.

## NOT verified against a live environment

`npm run build` cannot type-check GraphQL. Each shape is isolated in one
function in `src/utils/sitecore-graphql.ts`:

1. `searchRedirects` — criteria `_path` + `_templates` + `_language` on
   `sitecore_master_index`, ids passed as 32 lowercase chars. If the list comes
   back empty for a site that has redirects, `_templates` is the first suspect
   (fallback: drop it and filter on `innerItem { template { templateId } }`).
2. `listSites` reads `languages` off `xmc.xmapp.listSites`; when absent the
   site falls back to `en` only.
3. `languagesWithVersion` assumes `item(where:{language}) { version }` is
   null/0 for a language without a version.
4. `addItemVersion`, `deleteItem(permanently: false)`, `updateItem` without
   `version`/`path` (latest version of the language).
5. `getPublishStatus` — `publishingStatus(publishingOperationId:)` with
   `isDone` / `isFailed` / `state`. If it errors the flow waits a fixed ~8 s
   and reports "Publish requested".
6. Delete with unpublish = set `__Never publish` to `1`, publish the item,
   then delete. Confirm this really removes the item from Experience Edge.
7. URL ↔ item-name mapping (`routeOf`): lower case, spaces → hyphens. Lookups
   try the typed path and the hyphens-as-spaces variant.
8. The General Link XML written by `buildLinkXml`.
9. Environment selection assumes Full Screen reports exactly one
   `resourceAccess` entry and Standalone reports every environment the app is
   installed on, with a stable `tenantId`. If Full Screen reports several, the
   selector would appear there too and the remembered choice could differ from
   the environment the app was opened in.
10. `listChildren` (content tree) — `item { children { nodes { itemId name
   path hasChildren } } }`, the shape publishing-center already uses.

## Known limits (deliberate for v1)

- A redirect can only be created under an **existing** page: the item path is
  the URL and the app does not create intermediate items.
- The From path of an existing redirect cannot be changed (that is a move/rename).
- The internal destination is typed (URL path, Sitecore path or item ID) and
  checked on blur, or picked with **Browse** (`content-tree-dialog.tsx`), a
  lazy-loading tree rooted at the site's Home item (`rootPath + startItem`).
- No Import CSV yet (Export exists). No bulk publish/delete.
- Listing reads at most `SEARCH_MAX_PAGES × SEARCH_PAGE_SIZE` index documents.
- After create/edit the row is inserted locally (`buildRow`) rather than
  re-read, because the search index lags behind the write.
- Vercel redirects as a second source per site: planned, not built.

## Settings stores

- Admin setup: JSON in the `Value` field of
  `/sitecore/system/Modules/Marketplace/Redirect Manager/Settings`
  (`src/utils/settings.ts`). Only sites that differ from the SXA default are
  stored. Loading is best-effort (failure ⇒ defaults); saving throws ⇒ toast.
- Per-user: last environment, site + language in `localStorage`
  (`sitecoreai-redirect-manager-prefs`).

## Architecture

- Next.js 15 App Router, React 19, TS strict. Single client page
  (`src/app/page.tsx`) + one API route (`src/app/api/test/route.ts`).
- Base copied from `workbox` (config, `components/ui/*`, `globals.css`,
  `useMarketplaceClient`, the `runAuthoring` helpers); auth kit and SSRF guard
  from `webhooks`.
- Queries are string-interpolated; every interpolated value goes through
  `escapeGraphQL`. Never compare GUIDs directly — use `idKey()`.
- The sites list needs the **live** context id; authoring GraphQL the
  **preview** one.
- Styling follows `C:\Marketplace\STYLE-GUIDE.md`. Dev port 5014.
- Design mocks: https://claude.ai/artifact/LdPbNhNMD5nCSTtsE8McGW

Sibling folders under `C:\Marketplace` are reference material only — never
modify them.

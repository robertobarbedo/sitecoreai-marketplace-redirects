# Marketplace submission: Redirects

Copy-paste text for Sitecore's public-app submission form, in form order.
Replace `{{APP_URL}}` with the production deployment URL before submitting.

## 1. App name

Redirects

## 2. Headline

<!-- 102 chars -->

Create, edit, publish and test the SXA redirects of every site and language, without the content tree.

## 3. Description

SXA redirects are items in the content tree: the item's path is the old URL and a General Link field holds the destination. Managing them means browsing the tree, creating items one by one, publishing them and then checking the live site by hand. Redirects puts them on one screen for content authors and marketers, per site and language, and tests them against the live site.

Managing redirects:
- One picker for site and language, showing each language's live URL
- A list of every redirect of the site with its destination, last modified date and user, with search and CSV export
- Create and edit redirects to a page in the site (typed, or picked from the content tree) or to an external URL
- Create a redirect in every language of the site at once, with the same destination
- "Publish immediately, then test the live URL", with live progress
- Delete with an option to unpublish first, so the URL stops redirecting right away

Testing:
- Test one redirect or all of them: the app requests the live URL, follows every hop and reports Working, Warning or Broken
- Detects redirects that are not published, redirect chains, loops, destinations that return errors and redirects that land on another URL
- Every hop's status code and URL is shown
- Sites behind Vercel Deployment Protection are supported with a Protection Bypass for Automation secret, sealed on the server and sent only to the site's own hosts
- Chains can be allowed per site where they are expected

Setup:
- Works with the standard SXA redirect template out of the box; a site can use its own template, field and redirects folder
- Live URL overrides per language
- Settings are stored in your own content tree

Use cases:
- Add redirects for a campaign or a site restructure
- Find broken or unpublished redirects before visitors do
- Audit and export the redirects of a site

## 4. Financial model

Free

## 5. Categories

Suggested (match to the portal's category list before submitting):
- Content management
- SEO

## 6. Screenshots to capture

PNG, shown as 600×900 thumbnails. Capture during live QA.

1. Redirect list with test results (Working, Warning and Broken), one row's details expanded showing the hops.
2. Site and language picker with several sites.
3. New redirect dialog with a page picked from the content tree and "all languages" offered.
4. Content tree picker (Browse).
5. Publish-and-test progress dialog.
6. Site Settings, General tab (template, field, live URLs, allow redirect chains).

## 7. Links

- Website: https://github.com/robertobarbedo/sitecoreai-marketplace-redirects
- Support: https://github.com/robertobarbedo/sitecoreai-marketplace-redirects/issues
- Privacy policy: https://github.com/robertobarbedo/sitecoreai-marketplace-redirects/blob/main/PRIVACY.md
- Terms of service: https://github.com/robertobarbedo/sitecoreai-marketplace-redirects/blob/main/TERMS.md

## 8. Data usage disclosure

Paste from `DATA-USAGE.md`.

Summary: redirect items and site setup stay between the browser and the customer's SitecoreAI environment through the Marketplace SDK, with the user's own permissions; settings are stored in an item in the customer's content tree. Tests go through the app's own signed-in `/api/test` route, which requests the live URL and its redirects and returns status codes and URLs only. An optional Vercel bypass secret is sealed on the server and stored only in encrypted form. Nothing is persisted server-side; audit logs (no tokens, secrets, URL paths, headers or bodies) are kept for 90 days.

## 9. AI usage disclosure switch

Off. The app does not use AI or machine learning.

## 10. Configuration tab

- Extension points: **Full Screen**, route `/`; **Standalone** (Cloud Portal), route `/`. Opened as Standalone with several environments, the app shows an environment selector.
- API access: **SitecoreAI APIs** (the app calls `xmc.authoring.graphql`, `xmc.xmapp.listSites` and `application.context` through the Marketplace SDK).
- Permissions: **File downloads** (Export writes a CSV through a Blob download link). No clipboard, no `window.open`, no links that open a new tab.
- Deployment URL: `{{APP_URL}}`
- Client credentials (custom authorization): **Yes**, required for testing and for saving a Vercel bypass secret (every `/api/*` route). Listing, creating, editing, deleting and publishing work without it. Create Single-page app credentials and register:
  - Allowed callback URL: `{{APP_URL}}/` (with trailing slash)
  - Logout URL, web origin, CORS origin: `{{APP_URL}}`
- Environment variables on the host:
  - `NEXT_PUBLIC_AUTH0_CLIENT_ID` (required)
  - `NEXT_PUBLIC_SITECORE_APP_ID` (required)
  - `SECRET_ENCRYPTION_KEY` (required to save Vercel bypass secrets; server-only, 16+ characters)
  - Optional: `NEXT_PUBLIC_AUTH0_DOMAIN`, `NEXT_PUBLIC_AUTH0_AUDIENCE`, `NEXT_PUBLIC_AUTH0_SCOPE`, `AUTH0_ISSUER`, `CSP_FRAME_ANCESTORS`
- App logo: `public/signpost-duotone.svg`

## 11. Submission details (visible only to Sitecore)

- Contact name: `Roberto Barbedo`
- Contact email: `roberto.barbedo@msqdx.com`

**App functionality**

Redirects is a Next.js 15 full-stack app on the Full Screen and Standalone extension points. Managing redirects runs in the browser: it lists sites with `xmc.xmapp.listSites`, finds redirect items through the authoring search index and reads, creates, versions, updates, publishes and deletes them through the Marketplace SDK (`xmc.authoring.graphql`) with built-in Marketplace authorization and the user's own permissions. Site setup is stored as JSON at `/sitecore/system/Modules/Marketplace/Redirect Manager/Settings`. Two server routes require a Sitecore Cloud token from custom authorization (Auth0 SPA client credentials): `/api/test` follows a redirect's live URL one hop at a time and returns only each hop's status code and URL, and `/api/vercel-secret` seals a Vercel Protection Bypass for Automation secret. There is no database.

**Business value / alignment with Sitecore standards**

The app gives authors a single screen for SXA redirects, which otherwise means working in the content tree item by item, and closes the loop by testing each redirect against the live site after publishing. It uses only supported Marketplace SDK APIs; redirects are standard SXA items created with the standard template by default, with the user's own permissions. The UI follows the Blok design language (Tailwind CSS v4, Radix UI). Security measures: middleware verifying a Sitecore Cloud token on every `/api/*` route (signature, issuer, audience, expiry and `azp` bound to this app's client ID); an SSRF guard on every test hop (https on the default port only, public addresses checked at connect time against DNS rebinding, 10 s timeout per hop, at most 8 hops, bodies not read, only status codes and URLs returned); a per-user rate limit on tests; the Vercel secret sealed with AES-256-GCM (HKDF-SHA256 key from `SECRET_ENCRYPTION_KEY`, organization ID and the site's host names as additional authenticated data), never shown again, sent only in a header and only to the hosts it was sealed for, with no plaintext fallback; security headers on every response (HSTS, CSP frame-ancestors limited to SitecoreAI, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) and no caching of API responses; and JSON audit logging of sign-in decisions, tests and secret sealing without tokens, secrets, URL paths, headers or bodies. Fonts are bundled with the app; no analytics.

**Licensing note**

Next.js lists sharp (LGPL-3.0 libvips) as an optional dependency for image optimization; this app doesn't use next/image and sets images.unoptimized, so sharp is never loaded. lightningcss (MPL-2.0) is a build-time-only dependency of Tailwind CSS and is not shipped. The bundled Inter and JetBrains Mono fonts are licensed under the SIL Open Font License 1.1 (texts in src/app/fonts/OFL-*.txt).

## 12. Pre-submit checklist

Live QA in a non-production SitecoreAI environment:

- [ ] The iframe renders in Full Screen and Standalone; the app initializes on SDK 0.4
- [ ] Standalone with several environments: the environment selector shows, the choice is remembered, and switching reloads sites and settings
- [ ] Full Screen reports a single environment (no selector shown)
- [ ] Sites load with their languages (`xmc.xmapp.listSites` `languages`; a site without them falls back to `en`)
- [ ] Redirect list is complete for a site that has redirects (search on `_path` + `_templates` + `_language`; if empty, `_templates` is the first suspect)
- [ ] Create a redirect under an existing page, to a page typed as a URL path, a Sitecore path and an item ID
- [ ] Browse: the content tree loads level by level from the site's Home, the current destination is pre-selected on edit, Home itself can be picked
- [ ] Create in all languages: one item, a version in each language (`addItemVersion`), the same destination; `languagesWithVersion` reports existing versions correctly
- [ ] Edit an existing redirect (`updateItem` writes the latest version of the language) and check the General Link XML in Sitecore
- [ ] URL ↔ item-name mapping: a page with spaces in its name resolves from the hyphenated URL
- [ ] "Publish immediately, then test": publish completes (`publishingStatus` `isDone` / `isFailed`), the test retries until the live site answers, and closing the dialog only skips remaining tests
- [ ] Delete with "Unpublish first" ticked: the redirect stops working on the live site and is removed from Experience Edge
- [ ] Delete with it unticked: the item goes to the recycle bin and stays live until the parent is published
- [ ] Sign-in works; an organization switch forces a new sign-in; audit lines (`auth`, `redirect.test`, `secret.seal`) appear in the logs with no URL paths, tokens or secrets
- [ ] Test and Test all report Working, Warning (chain, lands on another URL) and Broken (unpublished, 404 destination, loop) correctly
- [ ] "Allow redirect chains" on a site turns a chain into Working
- [ ] Test all on a large site stays under the rate limit (or recovers from a 429)
- [ ] Vercel tab: save a bypass secret for a protected site; tests then pass the protection; changing the site's live URLs shows the "re-enter" warning
- [ ] Export downloads a CSV inside the portal iframe
- [ ] `NEXT_PUBLIC_AUTH0_CLIENT_ID`, `NEXT_PUBLIC_SITECORE_APP_ID` and `SECRET_ENCRYPTION_KEY` set on the production host; app rebuilt
- [ ] Production client credentials registered with `{{APP_URL}}` callback, logout, web origin and CORS URLs
- [ ] Screenshots captured (PNG), with no real secrets or private sites visible
- [ ] `{{APP_URL}}` replaced with the production deployment URL in this form

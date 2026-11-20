# Redirects

A SitecoreAI Marketplace app for content authors and marketers who manage the
SXA redirects of their sites.

An SXA redirect is an item in the content tree: the item's path is the old
URL (`Home/promo/x` answers `/promo/x`) and a General Link field holds the
destination. Managing them normally means browsing the tree, creating items
one by one, publishing them and checking the live site by hand.

This app puts the redirects of a site and language on one screen. You can
list, create, edit, delete, publish and test them against the live site
without leaving SitecoreAI.

## Features

- **Site and language picker**: one dropdown grouped by site, showing each
  language's live URL (`www.example.com/pt`). Each site heading has a cog
  that opens its setup.
- **Redirect list**: From path, destination, test result and last modified
  date, with search, a filter by test result and CSV export.
- **Create and edit**: send visitors to a page in the site or to an external
  URL. A page can be typed (URL path, Sitecore path or item ID) or picked
  with **Browse**, a content tree starting at the site's Home item.
- **All languages at once**: one item with a version in every language of
  the site, all with the same destination.
- **Publish immediately, then test**: a live progress dialog saves, adds the
  other languages, publishes and tests the live URL up to five times (the
  first attempts can fail while caches update). It can be closed at any time.
- **Test** one redirect or **Test all**: the app requests the live URL,
  follows every hop and reports:
  - **Working**: one redirect, and the destination loads.
  - **Warning**: a redirect chain, or the redirect ends on another URL than
    the configured destination.
  - **Broken**: not redirecting (404 usually means not published), the
    destination returns an error, a loop, more than 8 hops, or the
    destination item is missing or empty.

  Click a result to see every hop's status code and URL.
- **Allow redirect chains** (per site, off by default): a chain whose final
  page loads is reported as Working instead of a warning.
- **Delete**: the confirmation offers **Unpublish first, then delete**
  (ticked by default), so the URL stops redirecting on the live site right
  away. Untick it for a quick delete; the redirect then stays live until its
  parent page is published.
- **Vercel Deployment Protection**: sites on protected Vercel deployments
  can be tested with a Protection Bypass for Automation secret.
- **Environment selector**: opened as Standalone from the Cloud Portal with
  several environments, a quiet selector above the header picks the
  environment; the choice is remembered per user.

## How it works

- Redirect items, the site list and the settings item are read and written
  in the browser through the Marketplace SDK (`xmc.authoring.graphql`,
  `xmc.xmapp.listSites`), with the signed-in user's own SitecoreAI
  permissions.
- Redirects are found through the authoring search index by path, template
  and language. After a create or edit the row is updated on the page
  directly, because the index catches up a little later.
- Every site starts on the standard SXA redirect template
  (`/sitecore/templates/Foundation/Experience Accelerator/Redirects/Redirect`,
  field `RedirectUrl`). Settings can point a site at its own template, field
  and redirects folder.

### API routes

Both routes require a signed-in Sitecore Cloud user of this app.

- `POST /api/test`: follows a live URL one hop at a time and returns each
  hop's HTTP status code and URL. Headers and page content are never
  returned. Rate limited per user.
- `POST /api/vercel-secret`: seals a Vercel bypass secret and returns only
  the encrypted form.

## Requirements

- A SitecoreAI (XM Cloud) organization and environment with SXA sites.
- Organization Admin or Owner rights in the Cloud Portal to create and
  install the app.
- A SitecoreAI user who can read, create, edit, publish and delete items
  under the sites' redirects, and write under
  `/sitecore/system/Modules/Marketplace` to save settings.
- For testing: Single-page app client credentials for this app (custom
  authorization, see below).

## Install in SitecoreAI

1. In the Cloud Portal, open **App Studio** and choose **Create App**.
2. Enter an app name (for example `Redirects`) and select type **Custom**.
3. Add the **Full Screen** extension point with route `/`, and optionally the
   **Standalone** extension point with route `/`.
4. Under API access, enable **SitecoreAI APIs**.
5. Under permissions, allow **File downloads** (for CSV export).
6. Set the deployment URL to `https://<your-deployment>/`.
7. Upload the app logo from
   [`public/signpost-duotone.svg`](public/signpost-duotone.svg).
8. Set up custom authorization: create client credentials of type
   **Single-page app**, and register your deployment origin
   (`https://<your-deployment>`) as callback URL (with a trailing `/`), logout
   URL, web origin and CORS origin. Put the client ID and the app ID in the
   deployment's environment variables (see below).
9. Install the app in your organization, then open **Redirects** from the
   apps menu of SitecoreAI.

## Deploy your own instance

```bash
npm install
npm run build
npm start
```

Deploy to Vercel or any Node.js host, then point the App Studio deployment URL
at it.

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | Yes, for testing | Client ID of the app's Single-page app client credentials. Without it everything except testing still works. |
| `NEXT_PUBLIC_SITECORE_APP_ID` | Yes, for testing | Marketplace app ID, sent at sign-in as `product_codes=mkp_<id>`. |
| `SECRET_ENCRYPTION_KEY` | Yes, for Vercel bypass secrets | Server-only. Passphrase of at least 16 characters used to seal Vercel bypass secrets (AES-256-GCM, key derived with HKDF-SHA256). Generate with `openssl rand -base64 32`. Keep it stable: changing it makes saved secrets unreadable. Never prefix it with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_AUTH0_DOMAIN` | No | Defaults to `auth.sitecorecloud.io`. |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | No | Defaults to `https://api-webapp.sitecorecloud.io`. |
| `NEXT_PUBLIC_AUTH0_SCOPE` | No | Defaults to `openid profile email offline_access`. |
| `AUTH0_ISSUER` | No | Server-only. Defaults to `https://auth.sitecorecloud.io/`. |
| `CSP_FRAME_ANCESTORS` | No | Sites allowed to embed the app, as space-separated CSP sources for the `Content-Security-Policy: frame-ancestors` header. Defaults to `'self' https://*.sitecorecloud.io`. |

See [`.env.example`](.env.example) for a template.

The app only runs inside SitecoreAI: the Marketplace SDK needs the SitecoreAI
host iframe. Opening the deployment directly in a browser shows "Could not
connect to SitecoreAI". For local development, run `npm run dev` (port
5014), expose it over HTTPS (for example with ngrok, or `npm run dev:https`),
and register that URL in a separate development app in App Studio.

## Configuration

Open Settings with the cog at the top right, or the cog next to a site in the
picker. Each site has two tabs:

- **General**: redirect template and field, the item the redirects live
  under (empty = the site's start item), the live URL per language (empty =
  the address from the site's settings), the default of "Publish
  immediately", and **Allow redirect chains**.
- **Vercel**: the site's Protection Bypass for Automation secret (Vercel →
  Deployment Protection). It is sealed when saved and never shown again; it
  can only be replaced or removed. It is bound to the site's live-URL hosts,
  so changing them means entering it again (the tab warns). Vercel Password
  Protection passwords are not supported; a bypass secret also gets past the
  password.

Settings are stored in the content tree of the environment at
`/sitecore/system/Modules/Marketplace/Redirect Manager/Settings`, as JSON in
the `Value` field. Only sites that differ from the SXA default are stored.
The app creates the folders on first save.

## Security and privacy

- **Authentication**: managing redirects uses the Marketplace SDK, so every
  read and write runs with the signed-in SitecoreAI user's own permissions.
  Every `/api/*` route requires a Sitecore Cloud sign-in token issued to this
  app (checked in middleware for signature, issuer, audience, expiry and
  client ID).
- **Tests**: requests go from this app's server to the redirect's live URL
  and each URL it redirects to. Only `https` URLs on the default port are
  allowed, every resolved address must be public (checked at connect time,
  which also blocks DNS rebinding), each hop times out after 10 seconds, at
  most 8 hops are followed and response bodies are not read. Only status
  codes and URLs are returned. Tests are rate limited per user, in memory
  per server instance.
- **Secrets**: the only stored secret is the optional Vercel bypass secret.
  The server seals it with AES-256-GCM using the deployment's
  `SECRET_ENCRYPTION_KEY`, with your Sitecore Cloud organization ID and the
  site's host names as authenticated data. Only the ciphertext reaches the
  content tree and the browser. During a test it is sent only in the
  `x-vercel-protection-bypass` header and only to those hosts, never to
  other destinations. Without the key the app refuses to save a secret; it
  never stores plaintext.
- **Security headers**: every response sends HSTS,
  `Content-Security-Policy: frame-ancestors` (only SitecoreAI may embed the
  app, see `CSP_FRAME_ANCESTORS`), `X-Content-Type-Options`,
  `Referrer-Policy` and `Permissions-Policy`; API responses are never cached.
- **Audit log**: sign-in decisions, tests and secret sealing are written as
  JSON audit lines with UTC timestamps to the server log: who acted (user and
  organization ID), the outcome and status, and for tests the target host
  name, hop count and result. They never contain tokens, secrets, URL paths,
  headers, bodies or content.
- **No analytics**: the app uses no analytics, tracking or advertising
  services, and no AI. Fonts are bundled with the app, so no request goes to
  Google Fonts.
- **Policies**: [Privacy policy](PRIVACY.md),
  [Terms of service](TERMS.md),
  [Data usage disclosure](DATA-USAGE.md) and
  [Security policy](SECURITY.md).

## Limitations

- A redirect can only be created under an existing page: the item path is
  the URL, and the app doesn't create the items in between.
- The From path of an existing redirect can't be changed (that would be a
  move or rename in Sitecore).
- No CSV import yet (export is available), and no bulk publish or delete.
- The list reads at most 5,000 index entries per site and language.
- Test results are kept only while the page is open.
- Tests only reach public `https` URLs, so internal or local sites can't be
  tested.
- Vercel Password Protection passwords aren't supported; use a bypass
  secret.

## Development

- Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, Radix UI,
  class-variance-authority, Marketplace SDK (`@sitecore-marketplace-sdk/client`
  and `/xmc`), `@auth0/auth0-react` and `jose` for sign-in.
- `npm run dev` starts the dev server on port 5014. `npm run build` runs the
  type check, lint and production build.
- Project structure:
  - `src/app/`: the page and the `/api/test` and `/api/vercel-secret` routes
  - `src/lib/`: secret sealing, Vercel bypass helpers, and the Sitecore Cloud
    sign-in kit in `marketplace-auth/` (see its
    [README](src/lib/marketplace-auth/README.md))
  - `src/utils/`: Authoring GraphQL helpers, redirect logic, the live test,
    settings storage, the SSRF-safe HTTPS client
  - `components/`: picker, table, dialogs, settings and UI primitives
  - `public/`: app icon

## Support

Report bugs and request features in
[GitHub Issues](https://github.com/robertobarbedo/sitecoreai-marketplace-redirects/issues).
Report security vulnerabilities privately as described in the
[Security policy](SECURITY.md). See also the [Privacy policy](PRIVACY.md),
[Terms of service](TERMS.md) and [Data usage disclosure](DATA-USAGE.md).
This is a community app and is not an official Sitecore product.

## License

Licensed under the Apache License 2.0 — see [LICENSE](LICENSE).

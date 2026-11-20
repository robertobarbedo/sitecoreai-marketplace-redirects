# Redirects for SitecoreAI

A SitecoreAI Marketplace app (Full Screen extension point) for managing SXA
redirect items: list, create, edit, delete and publish the redirects of a site,
and test them against the live site.

## What authors get

- One picker for site and language, showing the live URL (`www.example.com/pt`).
- A list of redirects: From path, destination, last modified.
- **Test** on a redirect, or **Test all**: the app requests the live URL,
  follows the redirects and reports Working, Warning (redirect chain, lands on
  another URL) or Broken (not redirecting, destination missing or returning an
  error, loop), with every hop shown.
- New and Edit, optionally for every language of the site at once.
- "Publish immediately, then test the live URL", with live progress.

## Setup

Every site starts on the standard SXA redirect template
(`/sitecore/templates/Foundation/Experience Accelerator/Redirects/Redirect`,
field `RedirectUrl`). Use the cog to change the template, field, the item the
redirects live under, or the live URL per language for a site.

## Deploying

1. `npm install` and `npm run build`.
2. Deploy (for example to Vercel) and register the app in App Studio with the
   **Full Screen** extension point on route `/`. App logo:
   [`public/arrow-fat-lines-right-duotone.svg`](public/arrow-fat-lines-right-duotone.svg),
   served at `/arrow-fat-lines-right-duotone.svg` once deployed.
3. For the Test buttons, enable API access for the app in the Cloud Portal,
   create Single-page app client credentials and set the variables in
   `.env.example`. See `src/lib/marketplace-auth/README.md`.

The app only works inside SitecoreAI; it cannot be opened as a standalone site.

## License

Apache-2.0

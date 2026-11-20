# Privacy Policy

**Last updated: 2026-11-20**

## Overview

This policy explains what data the Redirects app ("the app") handles, where
it goes, what is stored, and how you can exercise your rights. It applies to
the hosted app listed in the Sitecore Marketplace.

## Summary

- The app has no database. Everything it saves is written to your own
  SitecoreAI environment: the SXA redirect items you create or edit, and one
  settings item holding each site's redirect setup (a Vercel bypass secret
  only in encrypted form).
- The app uses no analytics, tracking or advertising services, and no AI.
- The only data kept on the app's servers are short audit and runtime log
  lines (who called the API, what operation, the outcome, and for redirect
  tests the target host name and the number of hops), retained for 90 days.
- Data leaves your browser only in the ways listed under
  [Where data goes](#where-data-goes).

## How the app works

The app runs inside SitecoreAI (Full Screen, or Standalone from the Cloud
Portal).

- **Managing redirects** runs entirely in your browser. It lists sites,
  reads and writes SXA redirect items, publishes them and reads the settings
  item through the Sitecore Marketplace SDK (Authoring and Management
  GraphQL API), with your own SitecoreAI permissions. This data does not
  reach the app's servers.
- **Testing a redirect** calls the app's own `/api/test` route with the
  redirect's live URL. The server requests that URL, follows the redirects
  one hop at a time and returns each hop's HTTP status code and URL.
- **Saving a Vercel bypass secret** (a site's Vercel tab in Settings) calls
  the app's `/api/vercel-secret` route, which returns the secret in
  encrypted form.

## What data the app handles

- **Redirect data**: the redirect items of the selected site (item path,
  destination link, last-modified date and user), destination item names and
  paths, and the site's live URLs. Read from and written to your environment
  in your browser only.
- **Site setup**: per site, the redirect template and field, the item the
  redirects live under, live URL overrides, the "Publish immediately" and
  "Allow redirect chains" options, and an optional sealed Vercel bypass
  secret.
- **Redirect test data**: the live URL being tested and, for each hop, the
  HTTP status code and URL. Headers and page content are not read back.
- **Vercel Protection Bypass for Automation secret**: entered by an admin
  for sites behind Vercel Deployment Protection.
- **Account identifiers**: your Sitecore Cloud user ID (the token's `sub`)
  and organization ID, taken from the access token when you use a test or
  save a Vercel secret.
- **Sign-in tokens**: your Sitecore Cloud access and refresh tokens, kept in
  your browser.
- **Preferences**: your last environment, site and language, kept in your
  browser.

## Where data goes

1. **Sitecore.** Authoring GraphQL and site-list requests, made through the
   Marketplace SDK, and sign-in requests to Sitecore Cloud (see
   [Sign-in](#sign-in)).
2. **The app's own server.** For a test, the browser sends your Sitecore
   Cloud access token, the live URL and, if the site has one, the sealed
   Vercel secret and its host list. For saving a Vercel secret, it sends the
   plaintext secret once and the site's host names; the server returns only
   the encrypted form, which is what gets stored.
3. **Your live site (tests).** The app's server sends `GET` requests to the
   redirect's live URL and to each URL it redirects to, without cookies. The
   sites see the requests coming from the app's server. When the site has a
   Vercel bypass secret, it is sent in the `x-vercel-protection-bypass`
   header, and only to the site's own hosts, never to other destinations.

The app does not sell or share data with anyone else.

## What is stored and where

| Data | Where | Retention |
| --- | --- | --- |
| Redirect items | Your SitecoreAI environment (under each site's start item, or the folder set in the site's setup) | Until you delete them |
| Site setup and sealed Vercel bypass secret | Your SitecoreAI environment, item `/sitecore/system/Modules/Marketplace/Redirect Manager/Settings` (`Value` field) | Until you delete the item |
| Audit log lines: time (UTC), API path, event (`auth`, `redirect.test`, `secret.seal`), outcome, HTTP status, Sitecore user ID, organization ID, denial reason, and for tests the target host name, number of hops and result | The publisher's server logs (Vercel runtime logs and the publisher's log store) | 90 days |
| Standard request metadata recorded by the hosting provider (IP address, time, path, user agent) | Vercel | 90 days at most |
| Sign-in tokens and current organization ID | Your browser's `localStorage` | Until you sign out, the session expires, or you clear site data |
| Last environment, site and language | Your browser's `localStorage` | Until you clear site data |

Test results are kept only on the page while it is open. Log lines never
contain tokens, secrets, URL paths or queries, headers, bodies or content.

## Who can access it

- **Items in your environment:** anyone with the matching SitecoreAI
  permissions, under your agreement with Sitecore. A stored Vercel secret
  can only be decrypted by this app's server, for a signed-in user of the
  same Sitecore Cloud organization, and only to send to the hosts it was
  saved for.
- **Server logs:** only the app's maintainer, for operating, securing and
  troubleshooting the app, and the hosting provider as a sub-processor.
- **Browser storage:** only you, on your own device.

## How data is protected

- All traffic uses HTTPS (TLS 1.2 or later) with HSTS.
- Every API route verifies your Sitecore Cloud access token (signature,
  issuer, audience, expiry and that it was issued to this app) before acting.
- The Vercel bypass secret is encrypted with AES-256-GCM, bound to your
  organization and the site's host names, before it is stored. The
  plaintext is never stored, logged or sent back to the browser.
- Tests only reach public `https` URLs on the default port; private and
  internal networks are blocked (addresses are checked at connect time), each
  hop times out after 10 seconds, at most 8 hops are followed, response
  bodies are not read, and only status codes and URLs are returned.
- Tests are rate limited per user.
- Security headers restrict which sites may embed the app.
- Logs are stored with the hosting provider's encryption at rest.

## Sign-in

Tests and saving a Vercel secret require you to sign in with your Sitecore
Cloud account (Sitecore's Auth0 tenant at `auth.sitecorecloud.io`). The
sign-in is handled by Sitecore. The app only receives the resulting access
and refresh tokens; the browser sends the refresh token back to Sitecore's
sign-in service to renew your session. Listing, creating, editing, deleting
and publishing redirects don't need this sign-in.

## Local storage

The app uses your browser's local storage for the sign-in tokens (access
and refresh tokens) and the current organization ID, so you stay signed in,
and for your last environment, site and language. The organization ID is
kept so that switching organization forces a new sign-in.

This data stays on your device. The access token is sent only to the app's
own server, and the refresh token only to Sitecore's sign-in service. You can
clear all of it by clearing your browser data for the app.

## Sub-processors and third parties

- **Vercel Inc.** (hosting). Serverless functions run in the United States
  (region `iad1`, Washington, D.C.) unless a deployment sets another region.
  See https://vercel.com/legal/privacy-policy.
- **Sitecore** (sign-in, the SitecoreAI APIs and Sitecore Cloud tokens),
  under your own agreement with Sitecore.
- **Your live sites and redirect destinations**, which receive the test
  requests you start from the app's server.

No analytics, tracking or advertising services are used.

## Your rights

Depending on where you live (for example under the GDPR or CCPA), you may
have the right to access, correct, delete, restrict or object to the
processing of your personal data, and to receive a copy of it.

To make a request, email roberto.barbedo@msqdx.com with the subject "Data
request". Include your Sitecore Cloud organization ID and, if you know it,
your user ID, so we can find the matching log lines. We answer within 30
days. The only personal data the publisher holds is in the server logs
described above. Data in your SitecoreAI environment is controlled by you and
your agreement with Sitecore. You can also complain to your local data
protection authority.

## Deletion

- **Server logs** are deleted automatically after 90 days. On a verified
  request we delete matching log lines sooner where the log store allows it.
- **Browser data** is deleted when you sign out or clear site data for the
  app.
- **Site setup and Vercel secrets**: remove a secret on the site's Vercel
  tab, or delete the item
  `/sitecore/system/Modules/Marketplace/Redirect Manager/Settings` (or the
  folder `/sitecore/system/Modules/Marketplace/Redirect Manager`).
- **Redirects** are deleted from the app or in Sitecore. Uninstalling the app
  does not remove the redirect items you created.

## Changes to this policy

We may update this policy from time to time. Changes are published in this
file and reflected in the "Last updated" date at the top.

## Contact

Questions about this policy: email roberto.barbedo@msqdx.com or open an issue at
https://github.com/robertobarbedo/sitecoreai-marketplace-redirects/issues.

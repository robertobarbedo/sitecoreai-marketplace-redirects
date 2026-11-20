import { NextResponse } from "next/server";

import { auditLog } from "@/src/lib/marketplace-auth/audit-log";
import { requireSitecoreUser } from "@/src/lib/marketplace-auth/server";
import { takeTestSlot } from "@/src/lib/rate-limit";
import { openSecret } from "@/src/lib/secret-crypto";
import {
  BYPASS_HEADER,
  callerOrganization,
  describeSecretError,
  parseHosts,
} from "@/src/lib/vercel-bypass";
import {
  BlockedUrlError,
  describeRequestError,
  safeRequest,
} from "@/src/utils/ssrfGuard";

/**
 * Follows a live URL's redirects one hop at a time and reports each hop's
 * status code. The caller is a signed-in Sitecore user (see `middleware.ts`).
 *
 * The response carries status codes and URLs only — never headers or body —
 * so the route cannot be used to read content from another host. Every hop
 * goes through the SSRF guard: https only, default port, public addresses
 * only, checked inside the socket's own DNS lookup.
 */
export const runtime = "nodejs";

const MAX_HOPS = 8;
const HOP_TIMEOUT_MS = 10_000;
const MAX_URL_LENGTH = 2000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

interface Hop {
  status: number;
  url: string;
}

export async function POST(request: Request) {
  // middleware.ts already denied anonymous callers; this gives us who it is
  // for the rate limit and the audit line.
  const auth = await requireSitecoreUser(request);
  if (!auth.ok) return auth.response;

  const limit = takeTestSlot(auth.user.sub);
  if (!limit.ok) {
    auditLog(request, {
      event: "redirect.test",
      outcome: "deny",
      status: 429,
      sub: auth.user.sub,
      org: auth.user.organizationId,
      reason: "rate_limited",
    });
    return NextResponse.json(
      {
        error: `Too many tests in a short time. Try again in ${limit.retryAfterSeconds} s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url, vercelBypass } = (body ?? {}) as {
    url?: unknown;
    vercelBypass?: { sealed?: unknown; hosts?: unknown } | null;
  };
  if (typeof url !== "string" || !url || url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: "A URL is required" }, { status: 400 });
  }

  // One audit line per test: who, which host, how it ended. Never the
  // bypass secret, headers or page content.
  const audit = (
    outcome: "allow" | "deny" | "error",
    detail: { result: string; hops?: number; reason?: string },
  ) =>
    auditLog(request, {
      event: "redirect.test",
      outcome,
      sub: auth.user.sub,
      org: auth.user.organizationId,
      targetHost: hostOf(url),
      bypass: vercelBypass ? true : undefined,
      ...detail,
    });

  // Optional Vercel Protection Bypass secret. It is opened only for the
  // caller's organization and the hosts it was sealed for, and only sent to
  // hops on those hosts — never to the external sites a redirect points to.
  let bypass: { secret: string; hosts: Set<string> } | null = null;
  if (vercelBypass) {
    const hosts = parseHosts(vercelBypass.hosts);
    if (typeof vercelBypass.sealed !== "string" || !hosts) {
      return NextResponse.json(
        { error: "Invalid Vercel bypass settings" },
        { status: 400 },
      );
    }
    const org = await callerOrganization(request);
    if (!org.ok) return org.response;
    try {
      bypass = {
        secret: openSecret(vercelBypass.sealed, {
          organizationId: org.organizationId,
          hosts,
        }),
        hosts: new Set(hosts),
      };
    } catch (error) {
      audit("error", { result: "error", reason: "secret_unreadable" });
      return NextResponse.json({
        hops: [],
        outcome: "error",
        error: describeSecretError(error),
      });
    }
  }

  const hops: Hop[] = [];
  const seen = new Set<string>();
  let current = url;

  try {
    for (;;) {
      if (seen.has(current)) {
        audit("allow", { result: "loop", hops: hops.length });
        return NextResponse.json({ hops, outcome: "loop" });
      }
      if (hops.length >= MAX_HOPS) {
        audit("allow", { result: "too-many", hops: hops.length });
        return NextResponse.json({ hops, outcome: "too-many" });
      }
      seen.add(current);

      const headers: Record<string, string> = {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "User-Agent": "SitecoreAI-Marketplace-Redirects/1.0 (redirect test)",
      };
      // Header, not query string: it is not echoed into Location headers or
      // the hop URLs returned to the browser, and needs no bypass cookie.
      if (bypass && bypass.hosts.has(hostOf(current))) {
        headers[BYPASS_HEADER] = bypass.secret;
      }

      const { response } = await safeRequest(current, {
        method: "GET",
        headers,
        timeoutMs: HOP_TIMEOUT_MS,
        maxBodyBytes: 1024,
        maxRedirects: 0,
        httpsOnly: true,
        skipBody: true,
      });

      hops.push({ status: response.status, url: current });

      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400;
      if (!isRedirect || !location) {
        audit("allow", { result: "final", hops: hops.length });
        return NextResponse.json({ hops, outcome: "final" });
      }
      current = new URL(location, current).toString();
    }
  } catch (error) {
    const blocked = error instanceof BlockedUrlError;
    audit(blocked ? "deny" : "error", {
      result: "error",
      hops: hops.length,
      reason: blocked ? "blocked_url" : "request_failed",
    });
    return NextResponse.json({
      hops,
      outcome: "error",
      error: describeRequestError(error),
      // The hop that could not be requested, so the UI can name it.
      failedUrl: blocked || hops.length > 0 ? current : url,
    });
  }
}

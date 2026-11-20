import type {
  RedirectRow,
  TestHop,
  TestResult,
  VercelBypass,
} from "@/src/types/redirects";
import { authedFetch } from "@/src/lib/marketplace-auth/authedFetch";
import { comparableUrl, fullUrl } from "@/src/utils/urls";

interface LiveResponse {
  hops?: TestHop[];
  outcome?: "final" | "loop" | "too-many" | "error";
  error?: string;
  failedUrl?: string;
}

function result(
  level: TestResult["level"],
  note: string,
  detail: string,
  hops: TestHop[] = [],
): TestResult {
  return { level, note, detail, hops };
}

/** The URL a working redirect should end on, or "" when it cannot be known. */
export function expectedUrl(row: RedirectRow, base: string): string {
  if (row.link.kind === "external") return row.link.url;
  if (row.link.kind === "internal" && row.targetRoute && base) {
    return fullUrl(base, row.targetRoute);
  }
  return "";
}

/**
 * Tests one redirect: first the Sitecore data (is there a destination, does the
 * linked item still exist), then the live URL through the server route, which
 * follows the redirects and reports every hop.
 */
/** How often one test waits out a 429 before reporting it. */
const RATE_LIMIT_RETRIES = 3;

export async function testRedirect(
  row: RedirectRow,
  base: string,
  /** The site's sealed Vercel bypass secret, when it has one. */
  vercelBypass: VercelBypass | null = null,
  /** Site setting: a chain counts as working, not as a warning. */
  allowChains = false,
): Promise<TestResult> {
  if (row.link.kind === "empty") {
    return result(
      "broken",
      "No destination set",
      "The destination field of this redirect is empty.",
    );
  }
  if (row.link.kind === "internal" && row.targetPath === null) {
    return result(
      "broken",
      "Destination is missing",
      "The page this redirect points to was deleted, or has no version in this language.",
    );
  }
  if (!base) {
    return result(
      "error",
      "No live URL",
      "This site has no live URL for this language. Add one in Settings to test it.",
    );
  }

  let live: LiveResponse;
  try {
    const request = () =>
      authedFetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fullUrl(base, row.from), vercelBypass }),
      });
    // The route rate-limits per user (see rate-limit.ts). A long "Test all"
    // can reach it: wait as told and retry rather than report an error.
    let response = await request();
    for (let retry = 0; response.status === 429 && retry < RATE_LIMIT_RETRIES; retry++) {
      const seconds = Number(response.headers.get("Retry-After")) || 5;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(seconds, 60) * 1000),
      );
      response = await request();
    }
    live = (await response.json().catch(() => ({}))) as LiveResponse;
    if (!response.ok) {
      return result(
        "error",
        "Could not run the test",
        live.error ||
          `The test service answered ${response.status}. Check the app's sign-in configuration.`,
      );
    }
  } catch (error) {
    return result(
      "error",
      "Could not run the test",
      error instanceof Error ? error.message : String(error),
    );
  }

  const hops = live.hops ?? [];
  const first = hops[0];
  const last = hops[hops.length - 1];
  const redirects = hops.filter((h) => h.status >= 300 && h.status < 400).length;

  if (live.outcome === "loop") {
    return result(
      "broken",
      "Redirect loop",
      "The redirects lead back to a URL that was already visited.",
      hops,
    );
  }
  if (live.outcome === "too-many") {
    return result(
      "broken",
      "Too many redirects",
      "The URL is still redirecting after eight hops.",
      hops,
    );
  }
  if (live.outcome === "error" || !first || !last) {
    return result(
      hops.length > 0 ? "broken" : "error",
      live.error || "Could not reach the URL",
      live.failedUrl
        ? `${live.error || "The request failed"}: ${live.failedUrl}`
        : live.error || "The request failed.",
      hops,
    );
  }

  if (first.status === 401 || first.status === 403) {
    return result(
      "broken",
      `${first.status} · site asks for a login`,
      vercelBypass
        ? `The live site answers ${first.status} even with the Vercel bypass secret. Check that the secret is current (Vercel → Deployment Protection → Protection Bypass for Automation) and that the site was redeployed after it changed.`
        : `The live site answers ${first.status}: it is probably protected (for example Vercel Deployment Protection). If it is on Vercel, add a bypass secret on the site's Vercel tab in Settings.`,
      hops,
    );
  }

  if (first.status < 300 || first.status >= 400) {
    return result(
      "broken",
      `${first.status} · not redirecting`,
      first.status === 404
        ? "The live site answers 404 at this URL. The redirect is probably not published yet."
        : `The live site answers ${first.status} at this URL instead of redirecting.`,
      hops,
    );
  }

  if (last.status >= 400) {
    return result(
      "broken",
      `Destination returns ${last.status}`,
      `The redirect works, but the page it ends on answers ${last.status}.`,
      hops,
    );
  }

  // With chains allowed, a chain that ends on a working page is a success.
  // The final URL usually differs from the configured destination in a chain
  // (that is what the extra hop does), so the "another URL" check is skipped.
  if (redirects > 1 && allowChains) {
    return result(
      "working",
      `OK · ${redirects} redirects`,
      `Visitors go through ${redirects} redirects before the final page, which loads. Chains are allowed for this site.`,
      hops,
    );
  }

  if (redirects > 1) {
    return result(
      "warning",
      `Chain · ${redirects} redirects`,
      `Visitors go through ${redirects} redirects before the final page.`,
      hops,
    );
  }

  const expected = expectedUrl(row, base);
  if (expected && comparableUrl(expected) !== comparableUrl(last.url)) {
    return result(
      "warning",
      "Lands on another URL",
      `The redirect ends on ${last.url}, not on the configured destination ${expected}.`,
      hops,
    );
  }

  return result(
    "working",
    `${first.status}, then ${last.status}`,
    "The URL redirects once and the destination loads.",
    hops,
  );
}

import { NextResponse } from "next/server";
import { requireSitecoreUser } from "@/src/lib/marketplace-auth/server";

/**
 * The API routes make server-side requests to live site URLs (/api/test) and
 * seal Vercel secrets (/api/vercel-secret), so they require a signed-in
 * Sitecore user of this app. Checking here rather
 * than per route means a new route can't forget the check.
 */
export async function middleware(request: Request) {
  const auth = await requireSitecoreUser(request);
  if (!auth.ok) return auth.response;
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
  // jose's full bundle trips the Edge runtime's API check on Next 15.5.24.
  runtime: "nodejs",
};

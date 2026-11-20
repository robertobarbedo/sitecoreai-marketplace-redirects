import { NextResponse } from "next/server";

import { sealSecret } from "@/src/lib/secret-crypto";
import {
  callerOrganization,
  describeSecretError,
  parseHosts,
} from "@/src/lib/vercel-bypass";

/**
 * Seals a Vercel Protection Bypass for Automation secret typed in a site's
 * setup. Takes `{ secret, hosts }`, returns `{ sealed, hosts }` — the
 * plaintext never comes back. The seal only opens for the caller's
 * organization and only for these hosts (see `secret-crypto.ts`).
 */
export const runtime = "nodejs";

const MAX_SECRET_LENGTH = 256;

export async function POST(request: Request) {
  let body: { secret?: unknown; hosts?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const secret = typeof body?.secret === "string" ? body.secret.trim() : "";
  if (!secret || secret.length > MAX_SECRET_LENGTH || /\s/.test(secret)) {
    return NextResponse.json(
      { error: "Enter the bypass secret exactly as Vercel shows it." },
      { status: 400 },
    );
  }

  const hosts = parseHosts(body?.hosts);
  if (!hosts) {
    return NextResponse.json(
      {
        error:
          "Set the site's live URLs on the General tab first: the secret is only sent to those hosts.",
      },
      { status: 400 },
    );
  }

  const org = await callerOrganization(request);
  if (!org.ok) return org.response;

  try {
    const sealed = sealSecret(secret, {
      organizationId: org.organizationId,
      hosts,
    });
    return NextResponse.json({ sealed, hosts });
  } catch (error) {
    return NextResponse.json(
      { error: describeSecretError(error) },
      { status: 500 },
    );
  }
}

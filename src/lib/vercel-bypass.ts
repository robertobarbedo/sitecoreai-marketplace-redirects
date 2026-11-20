import { NextResponse } from "next/server";

import { requireSitecoreUser } from "@/src/lib/marketplace-auth/server";
import {
  EncryptionUnavailableError,
  SecretSealError,
} from "@/src/lib/secret-crypto";

/** Vercel's documented header for Protection Bypass for Automation. */
export const BYPASS_HEADER = "x-vercel-protection-bypass";

const MAX_HOSTS = 50;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Validates a host list sent by the browser: plain DNS names only. */
export function parseHosts(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_HOSTS) {
    return null;
  }
  const hosts: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    const host = entry.trim().toLowerCase();
    if (host.length > 253 || !HOST_PATTERN.test(host)) return null;
    hosts.push(host);
  }
  return [...new Set(hosts)];
}

/** The caller's organization, required to seal or open a secret. */
export async function callerOrganization(
  request: Request,
): Promise<{ ok: true; organizationId: string } | { ok: false; response: NextResponse }> {
  const auth = await requireSitecoreUser(request);
  if (!auth.ok) return auth;
  if (!auth.user.organizationId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Your sign-in does not identify a Sitecore Cloud organization, so the Vercel secret cannot be used.",
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, organizationId: auth.user.organizationId };
}

/** A user-facing message for sealing errors; anything else is generic. */
export function describeSecretError(error: unknown): string {
  if (
    error instanceof EncryptionUnavailableError ||
    error instanceof SecretSealError
  ) {
    return error.message;
  }
  return "The Vercel secret could not be processed.";
}

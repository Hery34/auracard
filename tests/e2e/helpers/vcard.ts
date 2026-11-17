import { expect, type APIResponse } from "@playwright/test";

import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";
import { newAccount, type Account } from "./accounts";

export type VCardFields = {
  job_title?: string | null;
  company?: string | null;
  bio?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  website_url?: string | null;
};

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): writes never go through `authenticated` (0022). */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

/**
 * New `e2e-*` member (deleted by the global teardown) with a fresh slug, never requested before, so no cached
 * answer can exist for it. Its profile gets the given fields and publication state through `service_role`.
 */
export async function createProfile(options: { published: boolean; fields?: VCardFields }): Promise<Account> {
  const account = newAccount();
  const { data, error: createError } = await admin().auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
  });
  if (createError !== null || data.user === null) {
    throw createError ?? new Error("createUser returned no user");
  }
  const userId = data.user.id;
  const { error: registerError } = await admin().rpc("register_member", {
    p_user_id: userId,
    p_display_name: account.displayName,
    p_slug: account.slug,
  });
  if (registerError !== null) {
    throw registerError;
  }
  const { error } = await admin()
    .from("profiles")
    .update({ ...options.fields, is_published: options.published })
    .eq("owner_id", userId);
  if (error !== null) {
    throw error;
  }
  return account;
}

/** RFC 2425 §5.8.1: CRLF followed by one space is removed; the trailing CRLF leaves no empty line. */
export function unfoldVCard(content: string): string[] {
  expect(content.endsWith("\r\n"), "the vCard ends with CRLF").toBe(true);
  return content.replaceAll("\r\n ", "").slice(0, -2).split("\r\n");
}

/** Same values as `next.config.ts`, asserted on every public response. */
export function expectSecurityHeaders(response: APIResponse): void {
  const headers = response.headers();
  expect.soft(headers["x-content-type-options"]).toBe("nosniff");
  expect.soft(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect.soft(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
  expect.soft(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect.soft(headers["x-powered-by"]).toBeUndefined();
}

/** 0019, decision 7: every answer of `/v/` (200, 404, 429, 500) is neither stored by a cache nor indexed. */
export function expectNoStoreNoIndex(response: APIResponse): void {
  const headers = response.headers();
  const cacheControl = (headers["cache-control"] ?? "").split(",").map((directive) => directive.trim().toLowerCase());
  expect.soft(cacheControl, `Cache-Control (${response.status()})`).toEqual(expect.arrayContaining(["private", "no-store"]));
  expect.soft(headers["x-robots-tag"] ?? "", `X-Robots-Tag (${response.status()})`).toMatch(/\bnoindex\b/i);
}

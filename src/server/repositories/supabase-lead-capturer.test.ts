/**
 * Contract frozen by test-engineer (0032, decisions 2 and 8; ADR 0011, avenant du 18/11/2026).
 *
 * // src/server/repositories/supabase-lead-capturer.ts — service_role client, injected by container.ts only
 * // (added to the `adminAdapters` list of the ESLint rule no-restricted-imports).
 * export function makeSupabaseLeadCapturer(admin: CarnetClient): LeadCapturer;
 * // One call: rpc("capture_lead", { p_slug, p_name, p_email, p_message, p_idempotency_key, p_device_class });
 * // never `from(...)`. data (uuid) → ok({ leadId }). P0002 (unknown, unpublished or refusing profile) →
 * // err("not_found"), not logged as an error; any other error → logInfrastructureError("capture_lead", code),
 * // err("unexpected"). The log line never carries the slug, the name, the e-mail nor the message.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseLeadCapturer } from "@/server/repositories/supabase-lead-capturer";

import { fakeSupabaseAdmin } from "../../../tests/builders/fake-supabase-admin";
import { IDEMPOTENCY_KEY, LEAD_IDS, LEAD_SLUG } from "../../../tests/builders/lead";

const COMMAND = {
  slug: LEAD_SLUG,
  name: "Jean Visiteur",
  email: "jean.visiteur@example.test",
  message: "Bonjour",
  idempotencyKey: IDEMPOTENCY_KEY,
  deviceClass: "mobile",
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSupabaseLeadCapturer", () => {
  it("calls rpc('capture_lead') only, with every argument, and returns the lead id", async () => {
    const admin = fakeSupabaseAdmin({ data: LEAD_IDS[0], error: null });

    expect(await makeSupabaseLeadCapturer(admin.client).capture(COMMAND)).toStrictEqual(ok({ leadId: LEAD_IDS[0] }));

    expect(admin.calls).toStrictEqual([
      {
        fn: "capture_lead",
        args: {
          p_slug: LEAD_SLUG,
          p_name: "Jean Visiteur",
          p_email: "jean.visiteur@example.test",
          p_message: "Bonjour",
          p_idempotency_key: IDEMPOTENCY_KEY,
          p_device_class: "mobile",
        },
      },
    ]);
  });

  it("criterion 3: P0002 (profile unknown, unpublished or refusing messages) → not_found, no error logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = fakeSupabaseAdmin({ data: null, error: { code: "P0002", message: "profile not found", details: null, hint: null } });

    expect(await makeSupabaseLeadCapturer(admin.client).capture(COMMAND)).toStrictEqual(err("not_found"));
    expect(error).not.toHaveBeenCalled();
  });

  it("any other error → unexpected, logged by code only (no personal data)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = fakeSupabaseAdmin({
      data: null,
      error: {
        code: "23514",
        message: 'new row for relation "leads" violates check constraint "leads_email_format_check"',
        details: "Failing row contains (Jean Visiteur, jean.visiteur@example.test, Bonjour).",
        hint: null,
      },
    });

    expect(await makeSupabaseLeadCapturer(admin.client).capture(COMMAND)).toStrictEqual(err("unexpected"));

    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ level: "error", source: "capture_lead", code: "23514" });
    for (const value of [LEAD_SLUG, "Jean Visiteur", "jean.visiteur@example.test", "Bonjour"]) {
      expect(line).not.toContain(value);
    }
  });
});

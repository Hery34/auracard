/**
 * Contract frozen by test-engineer (0029, decisions 7 and 8; ADR 0011, avenant du 18/11/2026).
 *
 * // src/server/repositories/supabase-event-recorder.ts
 * export function makeSupabaseEventRecorder(admin: CarnetClient): EventRecorder;
 * // One call: rpc("record_public_event", { p_id, p_slug, p_type, p_source, p_link_id (null when absent),
 * // p_device_class }) (fiche 0034; decision 9 of 0029); never `from(...)`, never record_event.
 * // Error → logInfrastructureError("record_public_event", code), err("unexpected").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseEventRecorder } from "@/server/repositories/supabase-event-recorder";

import { EVENT_ID, LINK_ID, PROFILE_SLUG } from "../../../tests/builders/analytics";
import { fakeSupabaseAdmin } from "../../../tests/builders/fake-supabase-admin";

const VIEW = { id: EVENT_ID, slug: PROFILE_SLUG, type: "profile_view", source: "nfc", linkId: null, deviceClass: "mobile" } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSupabaseEventRecorder", () => {
  it("decisions 8 and 9: calls rpc('record_public_event') only, with every argument (p_link_id null when absent)", async () => {
    const admin = fakeSupabaseAdmin({ data: null, error: null });

    expect(await makeSupabaseEventRecorder(admin.client).record(VIEW)).toStrictEqual(ok(undefined));

    expect(admin.calls).toStrictEqual([
      {
        fn: "record_public_event",
        args: {
          p_id: EVENT_ID,
          p_slug: PROFILE_SLUG,
          p_type: "profile_view",
          p_source: "nfc",
          p_link_id: null,
          p_device_class: "mobile",
        },
      },
    ]);
  });

  it("passes the link of a link_click", async () => {
    const admin = fakeSupabaseAdmin({ data: null, error: null });

    await makeSupabaseEventRecorder(admin.client).record({ ...VIEW, type: "link_click", linkId: LINK_ID, deviceClass: "desktop" });

    expect(admin.calls).toMatchObject([{ fn: "record_public_event", args: { p_type: "link_click", p_link_id: LINK_ID, p_device_class: "desktop" } }]);
  });

  it("maps a PostgREST error to err('unexpected') and logs the code only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = fakeSupabaseAdmin({
      data: null,
      error: { code: "22023", message: "invalid analytics event", details: `slug ${PROFILE_SLUG}`, hint: null },
    });

    expect(await makeSupabaseEventRecorder(admin.client).record(VIEW)).toStrictEqual(err("unexpected"));

    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ level: "error", source: "record_public_event", code: "22023" });
    expect(line).not.toContain(PROFILE_SLUG);
  });
});

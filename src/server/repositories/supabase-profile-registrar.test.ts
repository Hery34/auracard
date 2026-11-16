import { afterEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseProfileRegistrar } from "@/server/repositories/supabase-profile-registrar";

import {
  CHECK_VIOLATION_ERROR,
  DUPLICATE_OWNER_ERROR,
  DUPLICATE_SLUG_ERROR,
  fakeSupabaseAdmin,
  PROJECT_INACTIVE_ERROR,
  UNKNOWN_USER_ERROR,
} from "../../../tests/builders/fake-supabase-admin";
import { GATEWAY_USER_ID } from "../../../tests/builders/fake-auth-gateway";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { aSlug } from "../../../tests/builders/slug";

const input = { userId: GATEWAY_USER_ID, displayName: "Élodie Durand-Mérel", slug: aSlug("elodie-durand-merel") };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSupabaseProfileRegistrar", () => {
  it("calls rpc('register_member') with p_user_id, p_display_name and p_slug", async () => {
    const admin = fakeSupabaseAdmin({ data: PROFILE_ID, error: null });

    await makeSupabaseProfileRegistrar(admin.client).register(input);

    expect(admin.calls).toStrictEqual([
      {
        fn: "register_member",
        args: { p_user_id: GATEWAY_USER_ID, p_display_name: "Élodie Durand-Mérel", p_slug: "elodie-durand-merel" },
      },
    ]);
  });

  it("maps the returned uuid to ok({ profileId })", async () => {
    const admin = fakeSupabaseAdmin({ data: PROFILE_ID, error: null });

    expect(await makeSupabaseProfileRegistrar(admin.client).register(input)).toStrictEqual(
      ok({ profileId: PROFILE_ID }),
    );
  });

  // Orchestrator decision (0007): every 23505 raised by register_member is a slug collision. By construction of
  // the SQL function (locked by pgTAP), profiles_slug_key is the only unique constraint that can conflict; the
  // adapter branches on the SQLSTATE only and never reads the message.
  it.each([
    ["profiles_slug_key", DUPLICATE_SLUG_ERROR],
    ["any other constraint named in the message", DUPLICATE_OWNER_ERROR],
  ])("maps 23505 to err('slug_taken') whatever the constraint (%s)", async (_label, error) => {
    const admin = fakeSupabaseAdmin({ data: null, error });

    expect(await makeSupabaseProfileRegistrar(admin.client).register(input)).toStrictEqual(err("slug_taken"));
  });

  it("maps P0001 (carnet inactive or missing from the registry) to err('project_inactive')", async () => {
    const admin = fakeSupabaseAdmin({ data: null, error: PROJECT_INACTIVE_ERROR });

    expect(await makeSupabaseProfileRegistrar(admin.client).register(input)).toStrictEqual(err("project_inactive"));
  });

  it.each([
    ["23503 (unknown user)", UNKNOWN_USER_ERROR],
    ["23514 (check violation)", CHECK_VIOLATION_ERROR],
    ["42501 (permission denied)", { code: "42501", message: "permission denied", details: null, hint: null }],
  ])("maps %s to err('unexpected')", async (_label, error) => {
    const admin = fakeSupabaseAdmin({ data: null, error });

    expect(await makeSupabaseProfileRegistrar(admin.client).register(input)).toStrictEqual(err("unexpected"));
  });

  it("maps a null uuid without error to err('unexpected')", async () => {
    const admin = fakeSupabaseAdmin({ data: null, error: null });

    expect(await makeSupabaseProfileRegistrar(admin.client).register(input)).toStrictEqual(err("unexpected"));
  });

  it("never writes the raw Postgres details, hint or message to the console (they may contain the whole row)", async () => {
    const spies = [
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
    ];
    const admin = fakeSupabaseAdmin({ data: null, error: CHECK_VIOLATION_ERROR });

    await makeSupabaseProfileRegistrar(admin.client).register(input);

    const logged = spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call)));
    for (const line of logged) {
      expect(line).not.toContain(CHECK_VIOLATION_ERROR.details);
      expect(line).not.toContain(CHECK_VIOLATION_ERROR.message);
    }
  });
});

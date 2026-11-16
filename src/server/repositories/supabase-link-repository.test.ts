/**
 * Contract frozen by test-engineer (0017, decisions 4 and 7; 0016 decision 8).
 *
 * // src/server/repositories/supabase-link-repository.ts
 * export function makeSupabaseLinkRepository(server: CarnetClient): LinkRepository;
 * // await server.rpc("replace_links", { p_profile_id, p_links }) — p_links: one object per link, in order,
 * // { id, platform, url, label } for an existing link, { platform, url, label } (or id null) for a new one, never `position`.
 * // Rows → SavedLink { id, platform, url, label, position } in the returned order.
 * // 42501 → not_found; 22023, 23514 → invalid_input; anything else → unexpected. Logs the SQLSTATE only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseLinkRepository } from "@/server/repositories/supabase-link-repository";

import { fakeSupabaseAdmin, type FakePostgrestError } from "../../../tests/builders/fake-supabase-admin";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { aHttpsUrl } from "../../../tests/builders/https-url";
import { aLink, LINK_IDS } from "../../../tests/builders/links";

const LIST = [
  aLink({ id: LINK_IDS[1], platform: "github", url: aHttpsUrl("https://github.com/elodie"), label: "Code" }),
  aLink({ platform: "website", url: aHttpsUrl("https://atelier-merel.example/") }),
  aLink({ id: LINK_IDS[0] }),
];

const ROWS = [
  {
    id: LINK_IDS[1],
    profile_id: PROFILE_ID,
    platform: "github",
    url: "https://github.com/elodie",
    label: "Code",
    position: 0,
    created_at: "2026-11-16T10:00:00+00:00",
    updated_at: "2026-11-16T10:00:00+00:00",
  },
  {
    id: LINK_IDS[2],
    profile_id: PROFILE_ID,
    platform: "website",
    url: "https://atelier-merel.example/",
    label: null,
    position: 1,
    created_at: "2026-11-16T10:00:00+00:00",
    updated_at: "2026-11-16T10:00:00+00:00",
  },
];

function postgrestError(code: string): FakePostgrestError {
  return {
    code,
    message: `raw message of ${code}: Failing row contains (https://SECRET-ROW.example/)`,
    details: "Failing row contains (SECRET-ROW)",
    hint: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeSupabaseLinkRepository", () => {
  it("decision 7: calls rpc('replace_links') with the profile id and the full ordered list, the id of every existing link included", async () => {
    const server = fakeSupabaseAdmin({ data: ROWS, error: null });

    await makeSupabaseLinkRepository(server.client).replace(PROFILE_ID, LIST);

    expect(server.calls).toHaveLength(1);
    const [call] = server.calls;
    expect(call?.fn).toBe("replace_links");
    const args = call?.args as { p_profile_id: string; p_links: Array<Record<string, unknown>> };
    expect(args.p_profile_id).toBe(PROFILE_ID);
    expect(args.p_links.map((link) => link.id ?? null)).toStrictEqual([LINK_IDS[1], null, LINK_IDS[0]]);
    expect(args.p_links.map(({ platform, url, label }) => ({ platform, url, label }))).toStrictEqual([
      { platform: "github", url: "https://github.com/elodie", label: "Code" },
      { platform: "website", url: "https://atelier-merel.example/", label: null },
      { platform: "linkedin", url: "https://www.linkedin.com/in/elodie-durand-merel", label: null },
    ]);
    for (const link of args.p_links) {
      expect(Object.keys(link).every((key) => ["id", "platform", "url", "label"].includes(key))).toBe(true);
    }
  });

  it("maps the returned rows to SavedLink (id, platform, url, label, position), internal columns dropped", async () => {
    const server = fakeSupabaseAdmin({ data: ROWS, error: null });

    expect(await makeSupabaseLinkRepository(server.client).replace(PROFILE_ID, LIST)).toStrictEqual(
      ok([
        { id: LINK_IDS[1], platform: "github", url: "https://github.com/elodie", label: "Code", position: 0 },
        { id: LINK_IDS[2], platform: "website", url: "https://atelier-merel.example/", label: null, position: 1 },
      ]),
    );
  });

  it("an empty list → rpc with p_links [] and ok([])", async () => {
    const server = fakeSupabaseAdmin({ data: [], error: null });

    expect(await makeSupabaseLinkRepository(server.client).replace(PROFILE_ID, [])).toStrictEqual(ok([]));
    expect(server.calls).toStrictEqual([{ fn: "replace_links", args: { p_profile_id: PROFILE_ID, p_links: [] } }]);
  });

  it.each([
    ["42501 (profile not editable by the caller)", "42501", "not_found"],
    ["22023 (unknown, foreign or duplicated id)", "22023", "invalid_input"],
    ["23514 (CHECK constraint of carnet.links)", "23514", "invalid_input"],
    ["40001 (serialization failure)", "40001", "unexpected"],
    ["PGRST301 (JWT expired)", "PGRST301", "unexpected"],
  ] as const)("maps %s to err(%j)", async (_label, code, error) => {
    const server = fakeSupabaseAdmin({ data: null, error: postgrestError(code) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await makeSupabaseLinkRepository(server.client).replace(PROFILE_ID, LIST)).toStrictEqual(err(error));
  });

  it("never writes the raw Postgres message or details to the console", async () => {
    const spies = [
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
    ];
    const server = fakeSupabaseAdmin({ data: null, error: postgrestError("40001") });

    await makeSupabaseLinkRepository(server.client).replace(PROFILE_ID, LIST);

    const logged = spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call)));
    for (const line of logged) {
      expect(line).not.toContain("SECRET-ROW");
    }
  });
});

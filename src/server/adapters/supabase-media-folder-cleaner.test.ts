/**
 * Contract frozen by test-engineer (0023, decision 2, step 1).
 *
 * // src/server/adapters/supabase-media-folder-cleaner.ts — server client carrying the session (never service_role,
 * // ADR 0011): the policies `carnet_media_*` of 0021 decide.
 * export function makeSupabaseMediaFolderCleaner(server: CarnetClient): MediaFolderCleaner;
 * // empty(profileId): lists the folder `<profileId>` of the bucket MEDIA_BUCKET ("carnet-media") page by page and removes
 * //   every object as `<profileId>/<name>`, until the folder lists empty → ok(undefined). Already empty → ok, no `remove`
 * //   call with an empty list. Never names an object outside `<profileId>/`, never another bucket.
 * // A `remove` that answers success but leaves the listed objects in place (policies filtering them out) →
 * //   err("unexpected") after a bounded number of calls, never an endless loop.
 * // Any Storage error → err("unexpected"), only the HTTP status logged (the message can carry an object name).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import { makeSupabaseMediaFolderCleaner } from "@/server/adapters/supabase-media-folder-cleaner";

import { fakeStorageBucket, type FakeStorageBucketOptions } from "../../../tests/builders/account";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";

const BUCKET = "carnet-media";
const OTHER_PROFILE_ID = "0f0e0d0c-0000-4000-8000-00000000000b";

function objectName(profileId: string, file: string): string {
  return `${profileId}/${file}`;
}

const OWN_OBJECTS = [
  objectName(PROFILE_ID, "avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg"),
  objectName(PROFILE_ID, "banner-5e6f7a8b-0000-4000-8000-000000000002.webp"),
  objectName(PROFILE_ID, "logo-9c0d1e2f-0000-4000-8000-000000000003.png"),
];
const OTHER_OBJECTS = [objectName(OTHER_PROFILE_ID, "avatar-1a2b3c4d-0000-4000-8000-000000000009.jpg")];

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function cleaner(options: FakeStorageBucketOptions) {
  const storage = fakeStorageBucket(options);
  return { storage, folder: makeSupabaseMediaFolderCleaner(storage.client) };
}

function removedNames(storage: ReturnType<typeof fakeStorageBucket>): string[] {
  return storage.calls.flatMap((call) => (call.method === "remove" ? [...call.names] : []));
}

describe("makeSupabaseMediaFolderCleaner", () => {
  it("criterion 1: removes every object of carnet-media/<profileId>/ and nothing else", async () => {
    const { storage, folder } = cleaner({
      objects: { [BUCKET]: [...OWN_OBJECTS, ...OTHER_OBJECTS], "other-bucket": [OWN_OBJECTS[0] ?? ""] },
    });

    expect(await folder.empty(PROFILE_ID)).toStrictEqual(ok(undefined));
    expect(storage.objectsOf(BUCKET)).toStrictEqual(OTHER_OBJECTS);
    expect(storage.objectsOf("other-bucket")).toStrictEqual([OWN_OBJECTS[0]]);
    expect(removedNames(storage).sort()).toStrictEqual([...OWN_OBJECTS].sort());
  });

  it("works on the bucket carnet-media only and lists the folder of the profile", async () => {
    const { storage, folder } = cleaner({ objects: { [BUCKET]: OWN_OBJECTS } });

    await folder.empty(PROFILE_ID);

    expect(new Set(storage.calls.map((call) => call.bucket))).toStrictEqual(new Set([BUCKET]));
    for (const call of storage.calls) {
      if (call.method === "list") {
        expect(call.path.replace(/\/$/, "")).toBe(PROFILE_ID);
      }
    }
    expect(removedNames(storage).every((name) => name.startsWith(`${PROFILE_ID}/`))).toBe(true);
  });

  it("a folder larger than one page (250 objects) is emptied completely", async () => {
    const many = Array.from({ length: 250 }, (_, index) =>
      objectName(PROFILE_ID, `avatar-1a2b3c4d-0000-4000-8000-${String(index).padStart(12, "0")}.jpg`),
    );
    const { storage, folder } = cleaner({ objects: { [BUCKET]: [...many, ...OTHER_OBJECTS] } });

    expect(await folder.empty(PROFILE_ID)).toStrictEqual(ok(undefined));
    expect(storage.objectsOf(BUCKET)).toStrictEqual(OTHER_OBJECTS);
  });

  it("criterion 3: an empty folder → ok without any remove call", async () => {
    const { storage, folder } = cleaner({ objects: { [BUCKET]: OTHER_OBJECTS } });

    expect(await folder.empty(PROFILE_ID)).toStrictEqual(ok(undefined));
    expect(storage.calls.filter((call) => call.method === "remove")).toStrictEqual([]);
  });

  it("criterion 3: executed twice → ok twice, the second run removes nothing", async () => {
    const { storage, folder } = cleaner({ objects: { [BUCKET]: OWN_OBJECTS } });

    expect(await folder.empty(PROFILE_ID)).toStrictEqual(ok(undefined));
    const removeCallsAfterFirst = storage.calls.filter((call) => call.method === "remove").length;
    expect(await folder.empty(PROFILE_ID)).toStrictEqual(ok(undefined));

    expect(storage.calls.filter((call) => call.method === "remove")).toHaveLength(removeCallsAfterFirst);
    expect(storage.objectsOf(BUCKET)).toStrictEqual([]);
  });

  it("objects listed but never removed (policies) → err('unexpected') after a bounded number of calls", async () => {
    const { storage, folder } = cleaner({ objects: { [BUCKET]: OWN_OBJECTS }, removeIgnored: true });

    expect(await folder.empty(PROFILE_ID)).toStrictEqual(err("unexpected"));
    expect(storage.calls.length).toBeLessThanOrEqual(10);
  });

  it("list fails → err('unexpected'), nothing removed, only the status logged", async () => {
    const { storage, folder } = cleaner({
      objects: { [BUCKET]: OWN_OBJECTS },
      failList: { call: 1, error: { name: "StorageApiError", message: `cannot read ${OWN_OBJECTS[0]}`, status: 500 } },
    });

    expect(await folder.empty(PROFILE_ID)).toStrictEqual(err("unexpected"));
    expect(storage.objectsOf(BUCKET)).toStrictEqual([...OWN_OBJECTS].sort());
    expect(logged.join("\n")).not.toContain(PROFILE_ID);
    expect(logged.join("\n")).toContain("500");
  });

  it("remove fails → err('unexpected'), the object name never logged", async () => {
    const { folder } = cleaner({
      objects: { [BUCKET]: OWN_OBJECTS },
      failRemove: { call: 1, error: { name: "StorageApiError", message: `cannot delete ${OWN_OBJECTS[0]}`, status: 403 } },
    });

    expect(await folder.empty(PROFILE_ID)).toStrictEqual(err("unexpected"));
    expect(logged.join("\n")).not.toContain(PROFILE_ID);
    expect(logged).toHaveLength(1);
  });
});

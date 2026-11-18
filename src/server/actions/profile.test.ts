/**
 * Contract frozen by test-engineer (0017, decisions 1 to 5; ADR 0012).
 *
 * // src/server/actions/profile.ts — "use server"
 * export type ProfileActionError = "invalid_input" | "unauthenticated" | "not_found" | "rate_limited" | "unexpected";
 * type ErrorState = { status: "error"; error: ProfileActionError; fields?: Record<string, string> };
 * export type UpdateProfileState = { status: "idle" } | ErrorState | { status: "saved" };
 * export type ReplaceLinksState = { status: "idle" } | ErrorState | { status: "saved"; links: SavedLink[] };
 *
 * // Fields: displayName, jobTitle, company, bio, contactEmail, phone, websiteUrl, isPublished, isIndexable, acceptsLeads (0032) (checkbox "on").
 * export async function updateProfileAction(previous: UpdateProfileState, formData: FormData): Promise<UpdateProfileState>;
 * // Field `links`: JSON array of { id?, platform, url, label? }, the full ordered list.
 * export async function replaceLinksAction(previous: ReplaceLinksState, formData: FormData): Promise<ReplaceLinksState>;
 *
 * // Chain: validate (profile-schemas, before createContainer) → use case (authenticate getUser, rate limit, authorize
 * // own profile, write) → map Result as is → on success only: updateTag(`profile:${slug}`) from next/cache (decision 10:
 * // the slug returned by the use case, read by getOwn; never revalidateTag, never the profile id; read-your-own-writes).
 * // No submitted value in the returned state.
 * // The use cases return ok({ profileId, slug }) / ok({ profileId, slug, links }).
 *
 * // src/server/container.ts — Container gains `updateProfile: UpdateProfile` and `replaceLinks: ReplaceLinks`.
 *
 * // 0019, decision 7: the tag is built by `profileCacheTag(slug)` from `src/server/cache-tags.ts`, the same function
 * // as the cached public reader (never a template literal of its own).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/domain/shared/result";
import type { ReplaceLinksState, UpdateProfileState } from "@/server/actions/profile";

import { stubValidEnv } from "../../../tests/builders/env";
import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import { aSavedLink, LINK_IDS } from "../../../tests/builders/links";

const mocks = vi.hoisted(() => ({
  createContainer: vi.fn(),
  updateProfile: vi.fn(),
  replaceLinks: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  profileCacheTag: vi.fn(),
}));

vi.mock("@/server/cache-tags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/cache-tags")>();
  mocks.profileCacheTag.mockImplementation(actual.profileCacheTag);
  return { profileCacheTag: mocks.profileCacheTag };
});

vi.mock("@/server/container", () => ({ createContainer: mocks.createContainer }));

vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  updateTag: mocks.updateTag,
  revalidatePath: vi.fn(),
}));

const SLUG = "elodie-durand-merel";
const TAG = `profile:${SLUG}`;
const USE_CASE_ERRORS = ["unauthenticated", "not_found", "rate_limited", "invalid_input", "unexpected"] as const;

const idleProfile: UpdateProfileState = { status: "idle" };
const idleLinks: ReplaceLinksState = { status: "idle" };

const validProfileForm = {
  displayName: "  Élodie Durand-Mérel  ",
  jobTitle: "Architecte d'intérieur",
  company: "",
  bio: "Bureaux et commerces.\nLyon.",
  contactEmail: "contact@atelier-merel.example",
  phone: "+33 6 12 34 56 78",
  websiteUrl: "HTTPS://Atelier-Merel.example",
  isPublished: "on",
};

const expectedUpdate = {
  displayName: "Élodie Durand-Mérel",
  jobTitle: "Architecte d'intérieur",
  company: null,
  bio: "Bureaux et commerces.\nLyon.",
  contactEmail: "contact@atelier-merel.example",
  phone: "+33 6 12 34 56 78",
  websiteUrl: "https://atelier-merel.example/",
  isPublished: true,
  isIndexable: false,
  acceptsLeads: false,
};

const validLinks = [
  { id: LINK_IDS[1], platform: "github", url: "https://GitHub.com/elodie", label: " Code " },
  { platform: "website", url: "https://atelier-merel.example", label: "" },
  { id: LINK_IDS[0], platform: "linkedin", url: "https://www.linkedin.com/in/elodie" },
];

const expectedLinks = [
  { id: LINK_IDS[1], platform: "github", url: "https://github.com/elodie", label: "Code" },
  { platform: "website", url: "https://atelier-merel.example/", label: null },
  { id: LINK_IDS[0], platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null },
];

const SAVED = [
  aSavedLink({ id: LINK_IDS[1], platform: "github", url: "https://github.com/elodie", label: "Code", position: 0 }),
  aSavedLink({ id: LINK_IDS[2], platform: "website", url: "https://atelier-merel.example/", position: 1 }),
  aSavedLink({ id: LINK_IDS[0], url: "https://www.linkedin.com/in/elodie", position: 2 }),
];

function form(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      data.set(name, value);
    }
  }
  return data;
}

function linksForm(links: unknown): FormData {
  return form({ links: JSON.stringify(links) });
}

function updatedTags(): unknown[] {
  return mocks.updateTag.mock.calls.map(([tag]) => tag);
}

let actions: typeof import("@/server/actions/profile");

beforeAll(async () => {
  stubValidEnv();
  actions = await import("@/server/actions/profile");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createContainer.mockImplementation(async () => ({
    updateProfile: mocks.updateProfile,
    replaceLinks: mocks.replaceLinks,
  }));
  mocks.updateProfile.mockResolvedValue(ok({ profileId: PROFILE_ID, slug: SLUG }));
  mocks.replaceLinks.mockResolvedValue(ok({ profileId: PROFILE_ID, slug: SLUG, links: SAVED }));
});

describe("updateProfileAction", () => {
  it("decision 3: validates, then calls updateProfile with the parsed full update → { status: 'saved' }", async () => {
    expect(await actions.updateProfileAction(idleProfile, form(validProfileForm))).toStrictEqual({ status: "saved" });

    expect(mocks.updateProfile).toHaveBeenCalledTimes(1);
    expect(mocks.updateProfile).toHaveBeenCalledWith(expectedUpdate);
  });

  it("0019 decision 7: the tag comes from profileCacheTag(slug) of src/server/cache-tags, the cached reader's one", async () => {
    await actions.updateProfileAction(idleProfile, form(validProfileForm));

    expect(mocks.profileCacheTag).toHaveBeenCalledWith(SLUG);
    expect(updatedTags()).toStrictEqual([mocks.profileCacheTag.mock.results[0]?.value]);
  });

  it("decision 1: a slug sent with the form is never passed on (the slug cannot be changed)", async () => {
    await actions.updateProfileAction(idleProfile, form({ ...validProfileForm, slug: "another-slug" }));

    const [update] = mocks.updateProfile.mock.calls[0] as [Record<string, unknown>];
    expect(update).not.toHaveProperty("slug");
  });

  it("criterion 3 / decision 10: success → updateTag('profile:<slug>') once, never 'profile:<id>' nor revalidateTag, after the use case", async () => {
    await actions.updateProfileAction(idleProfile, form(validProfileForm));

    expect(updatedTags()).toStrictEqual([TAG]);
    expect(updatedTags()).not.toContain(`profile:${PROFILE_ID}`);
    expect(mocks.updateTag).toHaveBeenCalledWith(TAG);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.updateProfile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateTag.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("decision 10: the tag is built from the slug returned by the use case, never from a slug sent with the form", async () => {
    mocks.updateProfile.mockResolvedValue(ok({ profileId: PROFILE_ID, slug: "atelier-merel" }));

    await actions.updateProfileAction(idleProfile, form({ ...validProfileForm, slug: "another-slug" }));

    expect(updatedTags()).toStrictEqual(["profile:atelier-merel"]);
  });

  it.each([
    ["a missing display name", { ...validProfileForm, displayName: undefined }],
    ["a blank display name", { ...validProfileForm, displayName: "   " }],
    ["a display name of 81 characters", { ...validProfileForm, displayName: "n".repeat(81) }],
    ["a bio of 501 characters", { ...validProfileForm, bio: "b".repeat(501) }],
    ["a malformed public e-mail", { ...validProfileForm, contactEmail: "not-an-email" }],
    ["a phone number with letters", { ...validProfileForm, phone: "06 ab" }],
    ["an http website", { ...validProfileForm, websiteUrl: "http://atelier-merel.example/" }],
    ["a javascript: website", { ...validProfileForm, websiteUrl: "javascript:alert(1)" }],
    ["a switch with an unexpected value", { ...validProfileForm, isIndexable: "maybe" }],
  ])(
    "criterion 1 (invalid input): %s → { status: 'error', error: 'invalid_input' } before building the container, no tag updated",
    async (_label, fields) => {
      expect(await actions.updateProfileAction(idleProfile, form(fields))).toMatchObject({
        status: "error",
        error: "invalid_input",
      });
      expect(mocks.createContainer).not.toHaveBeenCalled();
      expect(mocks.updateProfile).not.toHaveBeenCalled();
      expect(mocks.updateTag).not.toHaveBeenCalled();
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
    },
  );

  it("decision 2: no submitted value is reflected in the returned state", async () => {
    const state = await actions.updateProfileAction(
      idleProfile,
      form({
        displayName: "SENTINEL-NAME\u0007",
        jobTitle: `SENTINEL-JOB${"x".repeat(80)}`,
        contactEmail: "SENTINEL-MAIL",
        phone: "SENTINEL-PHONE",
        websiteUrl: "javascript:alert('SENTINEL-URL')",
        isPublished: "SENTINEL-SWITCH",
      }),
    );

    expect(state).toMatchObject({ status: "error", error: "invalid_input" });
    expect(JSON.stringify(state)).not.toContain("SENTINEL");
  });

  it.each(USE_CASE_ERRORS)("criterion 3: use case error %s → mapped as is, updateTag never called", async (error) => {
    mocks.updateProfile.mockResolvedValue(err(error));

    expect(await actions.updateProfileAction(idleProfile, form(validProfileForm))).toMatchObject({
      status: "error",
      error,
    });
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("replayed: submitting the same form twice sends the same full update twice and saves twice", async () => {
    const first = await actions.updateProfileAction(idleProfile, form(validProfileForm));
    const second = await actions.updateProfileAction(idleProfile, form(validProfileForm));

    expect(second).toStrictEqual(first);
    expect(mocks.updateProfile.mock.calls).toStrictEqual([[expectedUpdate], [expectedUpdate]]);
  });
});

describe("replaceLinksAction", () => {
  it("decisions 3, 4 and 7: validates, then calls replaceLinks with the full ordered list and the id of every existing link", async () => {
    await actions.replaceLinksAction(idleLinks, linksForm(validLinks));

    expect(mocks.replaceLinks).toHaveBeenCalledTimes(1);
    expect(mocks.replaceLinks).toHaveBeenCalledWith(expectedLinks);
  });

  it("success → { status: 'saved', links } with the stored ids (sent back by the editor on the next save)", async () => {
    expect(await actions.replaceLinksAction(idleLinks, linksForm(validLinks))).toStrictEqual({
      status: "saved",
      links: SAVED,
    });
  });

  it("criterion 3 / decision 10: success → updateTag('profile:<slug>') once, never 'profile:<id>' nor revalidateTag, after the use case", async () => {
    await actions.replaceLinksAction(idleLinks, linksForm(validLinks));

    expect(updatedTags()).toStrictEqual([TAG]);
    expect(updatedTags()).not.toContain(`profile:${PROFILE_ID}`);
    expect(mocks.updateTag).toHaveBeenCalledWith(TAG);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.replaceLinks.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateTag.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("decision 10: the tag is built from the slug returned by the use case", async () => {
    mocks.replaceLinks.mockResolvedValue(ok({ profileId: PROFILE_ID, slug: "atelier-merel", links: SAVED }));

    await actions.replaceLinksAction(idleLinks, linksForm(validLinks));

    expect(updatedTags()).toStrictEqual(["profile:atelier-merel"]);
  });

  it("0019 decision 7: the tag comes from profileCacheTag(slug) of src/server/cache-tags, the cached reader's one", async () => {
    await actions.replaceLinksAction(idleLinks, linksForm(validLinks));

    expect(mocks.profileCacheTag).toHaveBeenCalledWith(SLUG);
    expect(updatedTags()).toStrictEqual([mocks.profileCacheTag.mock.results[0]?.value]);
  });

  it("an empty list is valid (every link removed)", async () => {
    mocks.replaceLinks.mockResolvedValue(ok({ profileId: PROFILE_ID, slug: SLUG, links: [] }));

    expect(await actions.replaceLinksAction(idleLinks, linksForm([]))).toStrictEqual({ status: "saved", links: [] });
    expect(mocks.replaceLinks).toHaveBeenCalledWith([]);
  });

  it.each([
    ["a missing links field", form({})],
    ["a links field that is not JSON", form({ links: "[{" })],
    ["a links field that is not an array", linksForm({ platform: "github", url: "https://github.com/elodie" })],
    [
      "13 links",
      linksForm(Array.from({ length: 13 }, (_, index) => ({ platform: "website", url: `https://s${index}.example/` }))),
    ],
    ["a host inconsistent with the platform", linksForm([{ platform: "linkedin", url: "https://evil.example/in/x" }])],
    ["a javascript: URL", linksForm([{ platform: "website", url: "javascript:alert(1)" }])],
    ["a malformed id", linksForm([{ id: "42", platform: "github", url: "https://github.com/elodie" }])],
    [
      "a label of 41 characters",
      linksForm([{ platform: "website", url: "https://a.example/", label: "l".repeat(41) }]),
    ],
  ])(
    "criterion 1 (invalid input): %s → { status: 'error', error: 'invalid_input' } before building the container, no tag updated",
    async (_label, data) => {
      expect(await actions.replaceLinksAction(idleLinks, data)).toMatchObject({
        status: "error",
        error: "invalid_input",
      });
      expect(mocks.createContainer).not.toHaveBeenCalled();
      expect(mocks.replaceLinks).not.toHaveBeenCalled();
      expect(mocks.updateTag).not.toHaveBeenCalled();
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
    },
  );

  it("decision 2: no submitted value is reflected in the returned state", async () => {
    const state = await actions.replaceLinksAction(
      idleLinks,
      linksForm([
        { platform: "SENTINEL-PLATFORM", url: "https://a.example/" },
        { platform: "website", url: "javascript:alert('SENTINEL-URL')" },
        { platform: "website", url: "https://a.example/", label: `SENTINEL-LABEL\u202E${"l".repeat(40)}` },
        { id: "SENTINEL-ID", platform: "website", url: "https://a.example/" },
      ]),
    );

    expect(state).toMatchObject({ status: "error", error: "invalid_input" });
    expect(JSON.stringify(state)).not.toContain("SENTINEL");
  });

  it.each(USE_CASE_ERRORS)("criterion 3: use case error %s → mapped as is, updateTag never called", async (error) => {
    mocks.replaceLinks.mockResolvedValue(err(error));

    expect(await actions.replaceLinksAction(idleLinks, linksForm(validLinks))).toMatchObject({
      status: "error",
      error,
    });
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("replayed: the same list twice is forwarded twice unchanged", async () => {
    await actions.replaceLinksAction(idleLinks, linksForm(validLinks));
    await actions.replaceLinksAction(idleLinks, linksForm(validLinks));

    expect(mocks.replaceLinks.mock.calls).toStrictEqual([[expectedLinks], [expectedLinks]]);
  });
});

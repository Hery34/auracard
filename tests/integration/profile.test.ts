/**
 * 0017 — criterion 2, against the local Supabase stack (RLS of carnet.profiles and carnet.links, replace_links,
 * get_public_profile + get_public_links). Adapters under test (contract frozen by test-engineer):
 *
 * // src/server/repositories/supabase-profile-writer.ts
 * export function makeSupabaseProfileWriter(server: CarnetClient): ProfileWriter;           // update … where id = $1 under RLS
 * // src/server/repositories/supabase-link-repository.ts
 * export function makeSupabaseLinkRepository(server: CarnetClient): LinkRepository;         // rpc replace_links; listOwn: select under RLS, by position
 * // src/server/repositories/supabase-profile-reader.ts (decision 9)
 * export function makeSupabaseProfileReader(server: CarnetClient, mediaOrigin: string): ProfileReader; // getOwn: full OwnProfile under RLS (0021: + image URLs)
 * // src/server/repositories/supabase-public-profile-reader.ts
 * export function makeSupabasePublicProfileReader(client: CarnetClient, mediaOrigin: string): PublicProfileReader; // rpc get_public_profile + get_public_links
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProfileUpdate } from "@/domain/profile/profile";
import { err, ok } from "@/domain/shared/result";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseLinkRepository } from "@/server/repositories/supabase-link-repository";
import { makeSupabaseProfileReader } from "@/server/repositories/supabase-profile-reader";
import { makeSupabaseProfileWriter } from "@/server/repositories/supabase-profile-writer";
import { makeSupabasePublicProfileReader } from "@/server/repositories/supabase-public-profile-reader";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeGetOwnProfile } from "@/server/use-cases/get-own-profile";
import { makeGetPublicProfile } from "@/server/use-cases/get-public-profile";
import { makeReplaceLinks } from "@/server/use-cases/replace-links";
import { makeUpdateProfile } from "@/server/use-cases/update-profile";

import { aHttpsUrl } from "../builders/https-url";
import { aLink } from "../builders/links";
import { aProfileUpdate } from "../builders/profile-update";
import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient, anonClient, type CarnetClient } from "./setup/clients";
import { RUN_SECRET, UUID_PATTERN } from "./setup/fixtures";
import { createMember, createOutsider } from "./setup/members";

/** 0021: origin of the public image URLs built by the readers (any value: no image in this file). */
const MEDIA_ORIGIN = "http://127.0.0.1:54321";

const PROFILE_COLUMNS =
  "slug, display_name, job_title, company, bio, contact_email, phone, website_url, is_published, is_indexable";

function rowOf(slug: string, update: ProfileUpdate) {
  return {
    slug,
    display_name: update.displayName,
    job_title: update.jobTitle,
    company: update.company,
    bio: update.bio,
    contact_email: update.contactEmail,
    phone: update.phone,
    website_url: update.websiteUrl,
    is_published: update.isPublished,
    is_indexable: update.isIndexable,
  };
}

describe("profile writes and public read against the local Supabase stack", () => {
  const admin = adminClient();
  const emails: string[] = [];

  function track(email: string): string {
    emails.push(email);
    return email;
  }

  /** Every port bound to the session, as the per-request container does in production. */
  function useCasesOn(session: CarnetClient) {
    const deps = {
      auth: makeSupabaseAuthGateway(session),
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
      profiles: makeSupabaseProfileReader(session, MEDIA_ORIGIN),
    };
    return {
      updateProfile: makeUpdateProfile({ ...deps, writer: makeSupabaseProfileWriter(session) }),
      replaceLinks: makeReplaceLinks({ ...deps, links: makeSupabaseLinkRepository(session) }),
    };
  }

  /** Owner read for the editor (decision 9), bound to the session as in production. */
  function ownRead(session: CarnetClient) {
    return makeGetOwnProfile({
      auth: makeSupabaseAuthGateway(session),
      profiles: makeSupabaseProfileReader(session, MEDIA_ORIGIN),
      links: makeSupabaseLinkRepository(session),
    });
  }

  /** Cookie-less anonymous client: what the static public page uses (decision 6). */
  function publicRead() {
    return makeGetPublicProfile({ publicProfiles: makeSupabasePublicProfileReader(anonClient(), MEDIA_ORIGIN) });
  }

  async function profileRow(profileId: string) {
    const { data, error } = await admin.from("profiles").select(PROFILE_COLUMNS).eq("id", profileId).single();
    expect(error).toBeNull();
    return data;
  }

  async function linkRows(profileId: string) {
    const { data, error } = await admin
      .from("links")
      .select("id, platform, url, label, position")
      .eq("profile_id", profileId)
      .order("position");
    expect(error).toBeNull();
    return data ?? [];
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    const { survivingProfileIds } = await deleteUsersByEmail(admin, emails.splice(0));

    expect(survivingProfileIds).toStrictEqual([]);
  });

  describe("updateProfile", () => {
    it("criterion 2: the owner updates its profile for real under RLS (full update, slug unchanged)", async () => {
      const member = await createMember(admin, track);
      const update = aProfileUpdate({ isPublished: true, isIndexable: true });

      expect(await useCasesOn(member.session).updateProfile(update)).toStrictEqual(
        ok({ profileId: member.profileId, slug: member.slug }),
      );
      expect(await profileRow(member.profileId)).toStrictEqual(rowOf(member.slug, update));
    });

    it("replayed: the same update twice gives the same row", async () => {
      const member = await createMember(admin, track);
      const update = aProfileUpdate();
      const { updateProfile } = useCasesOn(member.session);

      expect(await updateProfile(update)).toStrictEqual(ok({ profileId: member.profileId, slug: member.slug }));
      const afterFirst = await profileRow(member.profileId);
      expect(await updateProfile(update)).toStrictEqual(ok({ profileId: member.profileId, slug: member.slug }));

      expect(await profileRow(member.profileId)).toStrictEqual(afterFirst);
    });

    it("clearing optional fields writes null (full update, not a merge)", async () => {
      const member = await createMember(admin, track);
      const { updateProfile } = useCasesOn(member.session);
      const cleared = aProfileUpdate({
        jobTitle: null,
        company: null,
        bio: null,
        contactEmail: null,
        phone: null,
        websiteUrl: null,
        isPublished: false,
      });

      await updateProfile(aProfileUpdate());
      expect(await updateProfile(cleared)).toStrictEqual(ok({ profileId: member.profileId, slug: member.slug }));

      expect(await profileRow(member.profileId)).toStrictEqual(rowOf(member.slug, cleared));
    });

    it("criterion 2: an account cannot modify another account's profile (writer → not_found, row unchanged)", async () => {
      const owner = await createMember(admin, track);
      const intruder = await createMember(admin, track);
      const before = await profileRow(owner.profileId);

      const result = await makeSupabaseProfileWriter(intruder.session).update(
        owner.profileId,
        aProfileUpdate({ displayName: "Intrus", isPublished: true }),
      );

      expect(result).toStrictEqual(err("not_found"));
      expect(await profileRow(owner.profileId)).toStrictEqual(before);
    });

    it("criterion 2: an account of another project has no profile to update (use case → not_found) and cannot reach a carnet profile", async () => {
      const owner = await createMember(admin, track);
      const outsider = await createOutsider(admin, track);
      const before = await profileRow(owner.profileId);

      expect(await useCasesOn(outsider.session).updateProfile(aProfileUpdate())).toStrictEqual(err("not_found"));
      expect(await makeSupabaseProfileWriter(outsider.session).update(owner.profileId, aProfileUpdate())).toStrictEqual(
        err("not_found"),
      );
      expect(await profileRow(owner.profileId)).toStrictEqual(before);
    });

    it("a signed-out client → err('unauthenticated'), nothing written", async () => {
      const member = await createMember(admin, track);
      const before = await profileRow(member.profileId);

      expect(await useCasesOn(anonClient()).updateProfile(aProfileUpdate())).toStrictEqual(err("unauthenticated"));
      expect(await profileRow(member.profileId)).toStrictEqual(before);
    });

    it("decision 8: once 60 profile writes are counted for the account, the next one → err('rate_limited'), row unchanged", async () => {
      const member = await createMember(admin, track);
      const limiter = makeSupabaseRateLimiter(admin, RUN_SECRET);
      for (let attempt = 1; attempt <= 60; attempt += 1) {
        expect(
          await limiter.consume({ scope: "profile-write", subject: member.userId, limit: 60, windowSeconds: 3600 }),
        ).toStrictEqual(ok({ allowed: true }));
      }
      const before = await profileRow(member.profileId);

      expect(await useCasesOn(member.session).updateProfile(aProfileUpdate())).toStrictEqual(err("rate_limited"));
      expect(await profileRow(member.profileId)).toStrictEqual(before);
    });
  });

  describe("replaceLinks", () => {
    const linkedin = aLink();
    const website = aLink({ platform: "website", url: aHttpsUrl("https://atelier-merel.example/"), label: "Atelier" });
    const github = aLink({ platform: "github", url: aHttpsUrl("https://github.com/elodie") });

    it("criterion 2: replace_links replayed with the returned ids → same state and same ids", async () => {
      const member = await createMember(admin, track);
      const repository = makeSupabaseLinkRepository(member.session);

      const first = await repository.replace(member.profileId, [linkedin, website]);
      expect(first.ok).toBe(true);
      if (!first.ok) {
        return;
      }
      for (const link of first.value) {
        expect(link.id).toMatch(UUID_PATTERN);
      }
      const withIds = first.value.map(({ id, platform, url, label }) =>
        aLink({ id, platform, url: aHttpsUrl(url), label }),
      );

      const second = await repository.replace(member.profileId, withIds);
      const third = await repository.replace(member.profileId, withIds);

      expect(second).toStrictEqual(first);
      expect(third).toStrictEqual(first);
      expect(await linkRows(member.profileId)).toStrictEqual(first.value);
    });

    it("decision 7: the use case keeps the id of every existing link when reordering, and creates only the new one", async () => {
      const member = await createMember(admin, track);
      const { replaceLinks } = useCasesOn(member.session);

      const created = await replaceLinks([linkedin, website]);
      expect(created.ok).toBe(true);
      if (!created.ok) {
        return;
      }
      const [savedLinkedin, savedWebsite] = created.value.links;
      if (savedLinkedin === undefined || savedWebsite === undefined) {
        throw new Error("two links expected");
      }

      const reordered = await replaceLinks([
        aLink({ ...website, id: savedWebsite.id }),
        github,
        aLink({ ...linkedin, id: savedLinkedin.id }),
      ]);

      expect(reordered.ok).toBe(true);
      if (!reordered.ok) {
        return;
      }
      expect(reordered.value.profileId).toBe(member.profileId);
      expect(reordered.value.slug).toBe(member.slug);
      const rows = await linkRows(member.profileId);
      expect(rows.map((row) => [row.position, row.platform])).toStrictEqual([
        [0, "website"],
        [1, "github"],
        [2, "linkedin"],
      ]);
      expect(rows[0]?.id).toBe(savedWebsite.id);
      expect(rows[2]?.id).toBe(savedLinkedin.id);
      expect([savedWebsite.id, savedLinkedin.id]).not.toContain(rows[1]?.id);
      expect(reordered.value.links).toStrictEqual(rows);
    });

    it("an empty list removes every link", async () => {
      const member = await createMember(admin, track);
      const { replaceLinks } = useCasesOn(member.session);

      await replaceLinks([linkedin, website]);

      expect(await replaceLinks([])).toStrictEqual(ok({ profileId: member.profileId, slug: member.slug, links: [] }));
      expect(await linkRows(member.profileId)).toStrictEqual([]);
    });

    it("criterion 2: an account cannot replace another account's links (not_found, links unchanged)", async () => {
      const owner = await createMember(admin, track);
      const intruder = await createMember(admin, track);
      await useCasesOn(owner.session).replaceLinks([linkedin, website]);
      const before = await linkRows(owner.profileId);

      expect(await makeSupabaseLinkRepository(intruder.session).replace(owner.profileId, [])).toStrictEqual(
        err("not_found"),
      );
      expect(await linkRows(owner.profileId)).toStrictEqual(before);
    });

    it("criterion 2: an account of another project cannot replace carnet links (not_found, links unchanged)", async () => {
      const owner = await createMember(admin, track);
      const outsider = await createOutsider(admin, track);
      await useCasesOn(owner.session).replaceLinks([linkedin]);
      const before = await linkRows(owner.profileId);

      expect(await useCasesOn(outsider.session).replaceLinks([github])).toStrictEqual(err("not_found"));
      expect(await makeSupabaseLinkRepository(outsider.session).replace(owner.profileId, [github])).toStrictEqual(
        err("not_found"),
      );
      expect(await linkRows(owner.profileId)).toStrictEqual(before);
    });

    it("an id of another profile's link → err('invalid_input') (22023), nothing changed on either side", async () => {
      const owner = await createMember(admin, track);
      const other = await createMember(admin, track);
      const otherLinks = await useCasesOn(other.session).replaceLinks([github]);
      expect(otherLinks.ok).toBe(true);
      if (!otherLinks.ok) {
        return;
      }
      await useCasesOn(owner.session).replaceLinks([linkedin]);
      const ownerBefore = await linkRows(owner.profileId);
      const foreignId = otherLinks.value.links[0]?.id ?? "";

      expect(await useCasesOn(owner.session).replaceLinks([aLink({ ...github, id: foreignId })])).toStrictEqual(
        err("invalid_input"),
      );
      expect(await linkRows(owner.profileId)).toStrictEqual(ownerBefore);
      expect(await linkRows(other.profileId)).toStrictEqual(otherLinks.value.links);
    });
  });

  describe("getOwnProfile (owner read for the editor, decision 9)", () => {
    it("decision 9: a fresh member → its full profile as registered (optional fields null, unpublished) and links: []", async () => {
      const member = await createMember(admin, track);

      expect(await ownRead(member.session)()).toStrictEqual(
        ok({
          profile: {
            id: member.profileId,
            slug: member.slug,
            displayName: member.displayName,
            jobTitle: null,
            company: null,
            bio: null,
            contactEmail: null,
            phone: null,
            websiteUrl: null,
            isPublished: false,
            isIndexable: false,
            avatarUrl: null,
            bannerUrl: null,
            logoUrl: null,
          },
          links: [],
        }),
      );
    });

    it("decision 9: the owner reads for real under RLS every editable field and its links with their ids, sorted by position", async () => {
      const member = await createMember(admin, track);
      const { updateProfile, replaceLinks } = useCasesOn(member.session);
      const update = aProfileUpdate({ isPublished: true, isIndexable: true });
      await updateProfile(update);
      await replaceLinks([
        aLink({ platform: "website", url: aHttpsUrl("https://atelier-merel.example/"), label: "Atelier" }),
        aLink(),
        aLink({ platform: "github", url: aHttpsUrl("https://github.com/elodie") }),
      ]);
      const rows = await linkRows(member.profileId);

      expect(await ownRead(member.session)()).toStrictEqual(
        ok({
          profile: {
            id: member.profileId,
            slug: member.slug,
            displayName: update.displayName,
            jobTitle: update.jobTitle,
            company: update.company,
            bio: update.bio,
            contactEmail: update.contactEmail,
            phone: update.phone,
            websiteUrl: update.websiteUrl,
            isPublished: true,
            isIndexable: true,
            avatarUrl: null,
            bannerUrl: null,
            logoUrl: null,
          },
          links: rows,
        }),
      );
      expect(rows.map((row) => row.position)).toStrictEqual([0, 1, 2]);
    });

    it("decision 9: links read by the owner, sent back as is, keep every id (first save of the editor)", async () => {
      const member = await createMember(admin, track);
      const { replaceLinks } = useCasesOn(member.session);
      await replaceLinks([aLink(), aLink({ platform: "github", url: aHttpsUrl("https://github.com/elodie") })]);
      const read = await ownRead(member.session)();
      expect(read.ok).toBe(true);
      if (!read.ok) {
        return;
      }

      const saved = await replaceLinks(
        read.value.links.map(({ id, platform, url, label }) => aLink({ id, platform, url: aHttpsUrl(url), label })),
      );

      expect(saved).toStrictEqual(ok({ profileId: member.profileId, slug: member.slug, links: read.value.links }));
    });

    it("RLS: another member of carnet does not read the owner's links (listOwn → ok([])) and gets only its own profile", async () => {
      const owner = await createMember(admin, track);
      const other = await createMember(admin, track);
      await useCasesOn(owner.session).replaceLinks([aLink()]);

      expect(await makeSupabaseLinkRepository(other.session).listOwn(owner.profileId)).toStrictEqual(ok([]));
      const read = await ownRead(other.session)();
      expect(read.ok && read.value.profile?.id).toBe(other.profileId);
      expect(read.ok && read.value.links).toStrictEqual([]);
    });

    it("RLS: an account of another project → ok({ profile: null, links: [] }) and reads none of the owner's links", async () => {
      const owner = await createMember(admin, track);
      const outsider = await createOutsider(admin, track);
      await useCasesOn(owner.session).replaceLinks([aLink()]);

      expect(await ownRead(outsider.session)()).toStrictEqual(ok({ profile: null, links: [] }));
      expect(await makeSupabaseLinkRepository(outsider.session).listOwn(owner.profileId)).toStrictEqual(ok([]));
    });

    it("a signed-out client → err('unauthenticated'); the anonymous key has no grant on carnet.links (listOwn → err('unexpected'), no row)", async () => {
      const member = await createMember(admin, track);
      await useCasesOn(member.session).replaceLinks([aLink()]);

      expect(await ownRead(anonClient())()).toStrictEqual(err("unauthenticated"));
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(await makeSupabaseLinkRepository(anonClient()).listOwn(member.profileId)).toStrictEqual(err("unexpected"));
    });
  });

  describe("getPublicProfile (cookie-less anonymous client)", () => {
    it("criterion 2: an unpublished profile → ok(null)", async () => {
      const member = await createMember(admin, track);
      await useCasesOn(member.session).replaceLinks([aLink()]);

      expect(await publicRead()(member.slug)).toStrictEqual(ok(null));
    });

    it("an unknown slug → ok(null)", async () => {
      expect(await publicRead()("it-0017-no-such-profile")).toStrictEqual(ok(null));
    });

    it("a published profile → its public fields and its links sorted by position (with their id, 0029/0034), no other internal column", async () => {
      const member = await createMember(admin, track);
      const { updateProfile, replaceLinks } = useCasesOn(member.session);
      const update = aProfileUpdate({ isPublished: true, isIndexable: false });
      await updateProfile(update);
      const saved = await replaceLinks([
        aLink({ platform: "website", url: aHttpsUrl("https://atelier-merel.example/"), label: "Atelier" }),
        aLink(),
        aLink({ platform: "github", url: aHttpsUrl("https://github.com/elodie") }),
      ]);
      if (!saved.ok) throw new Error(`replaceLinks failed: ${saved.error}`);
      const [websiteId, linkedinId, githubId] = saved.value.links.map((link) => link.id);

      expect(await publicRead()(member.slug)).toStrictEqual(
        ok({
          slug: member.slug,
          displayName: update.displayName,
          jobTitle: update.jobTitle,
          company: update.company,
          bio: update.bio,
          avatarUrl: null,
          bannerUrl: null,
          logoUrl: null,
          contactEmail: update.contactEmail,
          phone: update.phone,
          websiteUrl: update.websiteUrl,
          isIndexable: false,
          links: [
            { id: websiteId, platform: "website", url: "https://atelier-merel.example/", label: "Atelier", position: 0 },
            { id: linkedinId, platform: "linkedin", url: "https://www.linkedin.com/in/elodie-durand-merel", label: null, position: 1 },
            { id: githubId, platform: "github", url: "https://github.com/elodie", label: null, position: 2 },
          ],
        }),
      );
    });

    it("a published profile without links → links: []; unpublishing it again → ok(null)", async () => {
      const member = await createMember(admin, track);
      const { updateProfile } = useCasesOn(member.session);
      await updateProfile(aProfileUpdate({ isPublished: true }));

      const published = await publicRead()(member.slug);
      expect(published.ok && published.value?.links).toStrictEqual([]);

      await updateProfile(aProfileUpdate({ isPublished: false }));
      expect(await publicRead()(member.slug)).toStrictEqual(ok(null));
    });
  });
});

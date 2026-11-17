/**
 * 0021 (contract frozen by test-engineer, decision 6: the preview shows the stored images):
 * // src/ui/features/profile-editor/editor-state.ts
 * export type EditorImages = { avatarUrl: string | null; bannerUrl: string | null; logoUrl: string | null };
 * export function toEditorImages(profile: OwnProfile): EditorImages;          // the public URLs read by getOwnProfile
 * export function toPreviewProfile(slug: string, fields: EditorFields, links: readonly EditorLink[], images: EditorImages): PublicProfile;
 * // The images are copied as is (updated by the editor after each successful upload or removal, with the `url` of the
 * // action state); the display check (safeImageSrc) stays in toProfileCardView.
 */
import { describe, expect, it } from "vitest";

import {
  toEditorFields,
  toEditorImages,
  toEditorLinks,
  toPreviewProfile,
  type EditorImages,
} from "@/ui/features/profile-editor/editor-state";

import { anEditorLink } from "../../../../tests/builders/editor-links";
import { anOwnProfile } from "../../../../tests/builders/fake-profile-reader";
import { aSavedLink, LINK_IDS } from "../../../../tests/builders/links";

const NO_IMAGES: EditorImages = { avatarUrl: null, bannerUrl: null, logoUrl: null };
const MEDIA_PREFIX =
  "https://supabase.carnet.example/storage/v1/object/public/carnet-media/c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f/";
const IMAGES: EditorImages = {
  avatarUrl: `${MEDIA_PREFIX}avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg`,
  bannerUrl: `${MEDIA_PREFIX}banner-1a2b3c4d-0000-4000-8000-000000000001.webp`,
  logoUrl: `${MEDIA_PREFIX}logo-1a2b3c4d-0000-4000-8000-000000000001.png`,
};

describe("toEditorFields", () => {
  it("criterion 1: null fields of the stored profile become empty strings, the switches keep their value", () => {
    expect(toEditorFields(anOwnProfile({ isPublished: true }))).toStrictEqual({
      displayName: "Élodie Durand-Mérel",
      jobTitle: "",
      company: "",
      bio: "",
      contactEmail: "",
      phone: "",
      websiteUrl: "",
      isPublished: true,
      isIndexable: false,
    });
  });

  it("criterion 1: filled fields are copied as stored", () => {
    const fields = toEditorFields(
      anOwnProfile({
        jobTitle: "Architecte",
        company: "Atelier Mérel",
        bio: "Ligne 1\nLigne 2",
        contactEmail: "contact@atelier-merel.example",
        phone: "+33 6 12 34 56 78",
        websiteUrl: "https://atelier-merel.example/",
        isIndexable: true,
      }),
    );

    expect(fields).toMatchObject({
      jobTitle: "Architecte",
      company: "Atelier Mérel",
      bio: "Ligne 1\nLigne 2",
      contactEmail: "contact@atelier-merel.example",
      phone: "+33 6 12 34 56 78",
      websiteUrl: "https://atelier-merel.example/",
      isIndexable: true,
    });
  });
});

describe("toEditorLinks", () => {
  it("decision 6: sorts by position and keeps the stored id (key = id), null label → empty string", () => {
    const links = toEditorLinks([
      aSavedLink({ id: LINK_IDS[1], platform: "github", url: "https://github.com/elodie", position: 1, label: "Code" }),
      aSavedLink({ id: LINK_IDS[0], position: 0 }),
    ]);

    expect(links).toStrictEqual([
      { key: LINK_IDS[0], id: LINK_IDS[0], platform: "linkedin", url: "https://www.linkedin.com/in/elodie-durand-merel", label: "" },
      { key: LINK_IDS[1], id: LINK_IDS[1], platform: "github", url: "https://github.com/elodie", label: "Code" },
    ]);
  });
});

describe("toPreviewProfile", () => {
  it("criterion 1: the preview shows the unsaved form, trimmed, blank → null, links by row order without avatar", () => {
    const fields = {
      ...toEditorFields(anOwnProfile()),
      displayName: "  Élodie  ",
      jobTitle: "   ",
      bio: " Bonjour ",
      isIndexable: true,
    };
    const preview = toPreviewProfile("elodie-durand-merel", fields, [
      anEditorLink({ key: "b", id: null, platform: "website", url: " https://b.example/ ", label: "  " }),
      anEditorLink({ key: "a", label: " Profil " }),
    ], NO_IMAGES);

    expect(preview).toStrictEqual({
      slug: "elodie-durand-merel",
      displayName: "Élodie",
      jobTitle: null,
      company: null,
      bio: "Bonjour",
      avatarUrl: null,
      bannerUrl: null,
      logoUrl: null,
      contactEmail: null,
      phone: null,
      websiteUrl: null,
      isIndexable: true,
      links: [
        { platform: "website", url: "https://b.example/", label: null, position: 0 },
        { platform: "linkedin", url: "https://www.linkedin.com/in/elodie-durand-merel", label: "Profil", position: 1 },
      ],
    });
  });
});

describe("toEditorImages (0021)", () => {
  it("decision 6: the public URLs of the stored images, null when absent", () => {
    expect(toEditorImages(anOwnProfile(IMAGES))).toStrictEqual(IMAGES);
    expect(toEditorImages(anOwnProfile())).toStrictEqual(NO_IMAGES);
  });
});

describe("toPreviewProfile — images (0021)", () => {
  it("criterion 3: the preview shows the avatar, the banner and the logo as given", () => {
    const preview = toPreviewProfile("elodie-durand-merel", toEditorFields(anOwnProfile()), [], IMAGES);

    expect(preview).toMatchObject(IMAGES);
  });

  it("a removed image (null) is absent from the preview", () => {
    const preview = toPreviewProfile("elodie-durand-merel", toEditorFields(anOwnProfile()), [], {
      ...IMAGES,
      avatarUrl: null,
    });

    expect(preview.avatarUrl).toBeNull();
    expect(preview.bannerUrl).toBe(IMAGES.bannerUrl);
  });
});

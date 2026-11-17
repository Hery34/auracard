import { describe, expect, it } from "vitest";

import { toEditorFields, toEditorLinks, toPreviewProfile } from "@/ui/features/profile-editor/editor-state";

import { anEditorLink } from "../../../../tests/builders/editor-links";
import { anOwnProfile } from "../../../../tests/builders/fake-profile-reader";
import { aSavedLink, LINK_IDS } from "../../../../tests/builders/links";

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
    ]);

    expect(preview).toStrictEqual({
      slug: "elodie-durand-merel",
      displayName: "Élodie",
      jobTitle: null,
      company: null,
      bio: "Bonjour",
      avatarUrl: null,
      bannerUrl: null,
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

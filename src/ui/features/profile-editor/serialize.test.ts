import { describe, expect, it } from "vitest";

import { toEditorFields } from "@/ui/features/profile-editor/editor-state";
import { toLinksFormData, toProfileFormData } from "@/ui/features/profile-editor/serialize";

import { anEditorLink } from "../../../../tests/builders/editor-links";
import { anOwnProfile } from "../../../../tests/builders/fake-profile-reader";
import { LINK_IDS } from "../../../../tests/builders/links";

describe("toProfileFormData", () => {
  it("criterion 1: sends every text field (empty to clear it) and the switches as 'on' only when set", () => {
    const data = toProfileFormData({
      ...toEditorFields(anOwnProfile()),
      jobTitle: "Architecte",
      isPublished: true,
      acceptsLeads: false,
    });

    expect(Object.fromEntries(data)).toStrictEqual({
      displayName: "Élodie Durand-Mérel",
      jobTitle: "Architecte",
      company: "",
      bio: "",
      contactEmail: "",
      phone: "",
      websiteUrl: "",
      isPublished: "on",
    });
  });
});

describe("toProfileFormData — acceptsLeads (0032)", () => {
  it("« Recevoir des messages » set → acceptsLeads: 'on'; unset → absent", () => {
    const fields = toEditorFields(anOwnProfile());

    expect(toProfileFormData({ ...fields, acceptsLeads: true }).get("acceptsLeads")).toBe("on");
    expect(toProfileFormData({ ...fields, acceptsLeads: false }).has("acceptsLeads")).toBe(false);
  });
});

describe("toLinksFormData", () => {
  it("decision 6: the full ordered list in the 'links' field, id present only for stored links, no key", () => {
    const data = toLinksFormData([
      anEditorLink({ key: "new-0", id: null, platform: "website", url: "https://a.example/", label: "Site" }),
      anEditorLink({ id: LINK_IDS[1], key: LINK_IDS[1] }),
    ]);

    expect([...data.keys()]).toStrictEqual(["links"]);
    expect(JSON.parse(String(data.get("links")))).toStrictEqual([
      { platform: "website", url: "https://a.example/", label: "Site" },
      { id: LINK_IDS[1], platform: "linkedin", url: "https://www.linkedin.com/in/elodie-durand-merel", label: "" },
    ]);
  });

  it("criterion 2: an empty list (every link removed) is sent as []", () => {
    expect(toLinksFormData([]).get("links")).toBe("[]");
  });
});

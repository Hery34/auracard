import { describe, expect, it } from "vitest";

import { toProfileCardView, type ProfileLinkView } from "@/ui/features/profile/profile-card-view";
import { unscramble } from "@/ui/features/profile/scrambled-text";

import { aPublicProfile } from "../../../../tests/builders/fake-public-profile-reader";

const WHATSAPP_URL = "https://wa.me/33612345678";
const PHONE = "+33 6 12 34 56 78";
const EMAIL = "elodie.durand+carte@atelier-merel.example";
const MEDIA_ORIGIN = "https://supabase.carnet.example";
const LOCAL_MEDIA_ORIGIN = "http://127.0.0.1:54321";

function hrefOf(link: ProfileLinkView | undefined): string {
  if (link === undefined) {
    throw new Error("missing link");
  }
  return link.kind === "anchor" ? link.href : unscramble(link.contact.href);
}

describe("toProfileCardView — public page view model (0018, decisions 8 and 9)", () => {
  it("drops links whose URL is not a valid https URL", () => {
    const view = toProfileCardView(
      aPublicProfile({
        links: [
          { id: "a0000001-0000-4000-8000-000000000001", platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null, position: 0 },
          { id: "a0000002-0000-4000-8000-000000000002", platform: "website", url: "javascript:alert(1)", label: null, position: 1 },
          { id: "a0000003-0000-4000-8000-000000000003", platform: "x", url: "http://x.com/elodie", label: null, position: 2 },
          { id: "a0000004-0000-4000-8000-000000000004", platform: "document", url: "data:text/html,<script>alert(1)</script>", label: null, position: 3 },
          { id: "a0000005-0000-4000-8000-000000000005", platform: "github", url: "//github.com/elodie", label: null, position: 4 },
          { id: "a0000006-0000-4000-8000-000000000006", platform: "youtube", url: "https://www.youtube.com/@elodie", label: null, position: 5 },
        ],
      }),
      MEDIA_ORIGIN,
    );

    expect(view.links.map(hrefOf)).toEqual([
      "https://www.linkedin.com/in/elodie",
      "https://www.youtube.com/@elodie",
    ]);
  });

  it("drops a non-https website and avatar", () => {
    const view = toProfileCardView(aPublicProfile({ websiteUrl: "javascript:alert(1)", avatarUrl: "http://cdn.example/a.png" }), MEDIA_ORIGIN);

    expect(view.website).toBeNull();
    expect(view.avatarUrl).toBeNull();
  });

  it("keeps the links in position order", () => {
    const view = toProfileCardView(
      aPublicProfile({
        links: [
          { id: "a0000007-0000-4000-8000-000000000007", platform: "github", url: "https://github.com/elodie", label: null, position: 2 },
          { id: "a0000008-0000-4000-8000-000000000008", platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null, position: 0 },
          { id: "a0000009-0000-4000-8000-000000000009", platform: "instagram", url: "https://www.instagram.com/elodie", label: null, position: 1 },
        ],
      }),
      MEDIA_ORIGIN,
    );

    expect(view.links.map((link) => link.platform)).toEqual(["linkedin", "instagram", "github"]);
  });

  it("protects a WhatsApp link like the phone: revealed on click, no URL in clear", () => {
    const view = toProfileCardView(
      aPublicProfile({
        links: [{ id: "a000000a-0000-4000-8000-00000000000a", platform: "whatsapp", url: WHATSAPP_URL, label: null, position: 0 }],
      }),
      MEDIA_ORIGIN,
    );

    const [link] = view.links;
    expect(link?.kind).toBe("protected");
    if (link?.kind !== "protected") {
      return;
    }
    expect(unscramble(link.contact.href)).toBe(WHATSAPP_URL);
    expect(link.contact.text).toBeNull();
    expect(link.contact.external).toBe(true);
    expect(link.title).toBe("WhatsApp");
  });

  it("protects the phone and the e-mail: revealed on click", () => {
    const view = toProfileCardView(aPublicProfile({ phone: PHONE, contactEmail: EMAIL }), MEDIA_ORIGIN);

    expect(view.phone).not.toBeNull();
    expect(view.email).not.toBeNull();
    expect(unscramble(view.phone?.href ?? [])).toBe("tel:+33612345678");
    expect(unscramble(view.phone?.text ?? [])).toBe(PHONE);
    expect(unscramble(view.email?.href ?? [])).toBe(`mailto:${EMAIL}`);
    expect(unscramble(view.email?.text ?? [])).toBe(EMAIL);
  });

  it.each([
    ["a query (?bcc=)", "x@y.fr?bcc=a@b.c"],
    ["an ampersand", "x&bcc=a@y.fr"],
    ["a slash", "x/y@y.fr"],
    ["a colon", "mailto:x@y.fr"],
    ["a space", "x y@y.fr"],
  ])("decision 10: an e-mail with %s is not shown (email: null), like a missing one", (_case, contactEmail) => {
    const view = toProfileCardView(aPublicProfile({ contactEmail }), MEDIA_ORIGIN);

    expect(view.email).toBeNull();
    expect(JSON.stringify(view)).not.toContain("x@y.fr");
  });

  it("leaves no phone, e-mail, WhatsApp URL nor scheme in the serialized view", () => {
    const view = toProfileCardView(
      aPublicProfile({
        phone: PHONE,
        contactEmail: EMAIL,
        links: [
          { id: "a000000b-0000-4000-8000-00000000000b", platform: "whatsapp", url: WHATSAPP_URL, label: "Écrivez-moi", position: 0 },
          { id: "a000000c-0000-4000-8000-00000000000c", platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null, position: 1 },
        ],
      }),
      MEDIA_ORIGIN,
    );

    const serialized = JSON.stringify(view);
    for (const secret of [EMAIL, "612345678", "12 34 56", "mailto:", "tel:", "wa.me"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("points the vCard button to /v/{slug}", () => {
    expect(toProfileCardView(aPublicProfile({ slug: "elodie-durand-merel" }), MEDIA_ORIGIN).vcardHref).toBe("/v/elodie-durand-merel");
  });

  describe("0021: images (contract frozen by test-engineer)", () => {
    // ProfileCardView gains `bannerUrl: string | null` and `logoUrl: string | null`; avatarUrl, bannerUrl and logoUrl
    // all go through safeImageSrc (src/ui/features/profile/safe-image-src.ts).
    const PREFIX = "https://supabase.carnet.example/storage/v1/object/public/carnet-media/c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f/";
    const LOCAL_PREFIX = "http://127.0.0.1:54321/storage/v1/object/public/carnet-media/c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f/";

    it("decision 6: avatar, banner and logo URLs are kept for display", () => {
      const view = toProfileCardView(
        aPublicProfile({
          avatarUrl: `${PREFIX}avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg`,
          bannerUrl: `${PREFIX}banner-1a2b3c4d-0000-4000-8000-000000000001.webp`,
          logoUrl: `${PREFIX}logo-1a2b3c4d-0000-4000-8000-000000000001.png`,
        }),
        MEDIA_ORIGIN,
      );

      expect(view.avatarUrl).toBe(`${PREFIX}avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg`);
      expect(view.bannerUrl).toBe(`${PREFIX}banner-1a2b3c4d-0000-4000-8000-000000000001.webp`);
      expect(view.logoUrl).toBe(`${PREFIX}logo-1a2b3c4d-0000-4000-8000-000000000001.png`);
      expect(view.initials).toBe("ED");
    });

    it("the local stack (http://127.0.0.1:54321) is displayed too", () => {
      const view = toProfileCardView(aPublicProfile({ avatarUrl: `${LOCAL_PREFIX}avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg` }), LOCAL_MEDIA_ORIGIN);

      expect(view.avatarUrl).toBe(`${LOCAL_PREFIX}avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg`);
    });

    it("decision 12: an image from another origin than the configured one is dropped", () => {
      const view = toProfileCardView(
        aPublicProfile({
          avatarUrl: `${PREFIX}avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg`,
          bannerUrl: `${PREFIX}banner-1a2b3c4d-0000-4000-8000-000000000001.webp`,
          logoUrl: `${PREFIX}logo-1a2b3c4d-0000-4000-8000-000000000001.png`,
        }),
        "https://other-project.example",
      );

      expect([view.avatarUrl, view.bannerUrl, view.logoUrl]).toStrictEqual([null, null, null]);
    });

    it("decision 5: unsafe banner and logo URLs are dropped", () => {
      const view = toProfileCardView(aPublicProfile({ bannerUrl: "javascript:alert(1)", logoUrl: "http://cdn.example/l.png" }), MEDIA_ORIGIN);

      expect(view.bannerUrl).toBeNull();
      expect(view.logoUrl).toBeNull();
    });

    it("no image → null URLs", () => {
      const view = toProfileCardView(aPublicProfile(), MEDIA_ORIGIN);

      expect([view.avatarUrl, view.bannerUrl, view.logoUrl]).toStrictEqual([null, null, null]);
    });
  });
});

describe("toProfileCardView — link ids for the beacon (0029, decision 9)", () => {
  it("every link view, anchor or protected (WhatsApp), carries the id of its link (target of link_click)", () => {
    const view = toProfileCardView(
      aPublicProfile({
        links: [
          { id: "6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d", platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null, position: 0 },
          { id: "7b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e", platform: "whatsapp", url: WHATSAPP_URL, label: null, position: 1 },
        ],
      }),
      MEDIA_ORIGIN,
    );

    expect(view.links.map((link) => [link.kind, link.id])).toStrictEqual([
      ["anchor", "6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d"],
      ["protected", "7b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e"],
    ]);
  });
});

import { describe, expect, it } from "vitest";

import { toProfileCardView, type ProfileLinkView } from "@/ui/features/profile/profile-card-view";
import { unscramble } from "@/ui/features/profile/scrambled-text";

import { aPublicProfile } from "../../../../tests/builders/fake-public-profile-reader";

const WHATSAPP_URL = "https://wa.me/33612345678";
const PHONE = "+33 6 12 34 56 78";
const EMAIL = "elodie.durand+carte@atelier-merel.example";

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
          { platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null, position: 0 },
          { platform: "website", url: "javascript:alert(1)", label: null, position: 1 },
          { platform: "x", url: "http://x.com/elodie", label: null, position: 2 },
          { platform: "document", url: "data:text/html,<script>alert(1)</script>", label: null, position: 3 },
          { platform: "github", url: "//github.com/elodie", label: null, position: 4 },
          { platform: "youtube", url: "https://www.youtube.com/@elodie", label: null, position: 5 },
        ],
      }),
    );

    expect(view.links.map(hrefOf)).toEqual([
      "https://www.linkedin.com/in/elodie",
      "https://www.youtube.com/@elodie",
    ]);
  });

  it("drops a non-https website and avatar", () => {
    const view = toProfileCardView(aPublicProfile({ websiteUrl: "javascript:alert(1)", avatarUrl: "http://cdn.example/a.png" }));

    expect(view.website).toBeNull();
    expect(view.avatarUrl).toBeNull();
  });

  it("keeps the links in position order", () => {
    const view = toProfileCardView(
      aPublicProfile({
        links: [
          { platform: "github", url: "https://github.com/elodie", label: null, position: 2 },
          { platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null, position: 0 },
          { platform: "instagram", url: "https://www.instagram.com/elodie", label: null, position: 1 },
        ],
      }),
    );

    expect(view.links.map((link) => link.platform)).toEqual(["linkedin", "instagram", "github"]);
  });

  it("protects a WhatsApp link like the phone: revealed on click, no URL in clear", () => {
    const view = toProfileCardView(
      aPublicProfile({
        links: [{ platform: "whatsapp", url: WHATSAPP_URL, label: null, position: 0 }],
      }),
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
    const view = toProfileCardView(aPublicProfile({ phone: PHONE, contactEmail: EMAIL }));

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
    const view = toProfileCardView(aPublicProfile({ contactEmail }));

    expect(view.email).toBeNull();
    expect(JSON.stringify(view)).not.toContain("x@y.fr");
  });

  it("leaves no phone, e-mail, WhatsApp URL nor scheme in the serialized view", () => {
    const view = toProfileCardView(
      aPublicProfile({
        phone: PHONE,
        contactEmail: EMAIL,
        links: [
          { platform: "whatsapp", url: WHATSAPP_URL, label: "Écrivez-moi", position: 0 },
          { platform: "linkedin", url: "https://www.linkedin.com/in/elodie", label: null, position: 1 },
        ],
      }),
    );

    const serialized = JSON.stringify(view);
    for (const secret of [EMAIL, "612345678", "12 34 56", "mailto:", "tel:", "wa.me"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("points the vCard button to /v/{slug}", () => {
    expect(toProfileCardView(aPublicProfile({ slug: "elodie-durand-merel" })).vcardHref).toBe("/v/elodie-durand-merel");
  });
});

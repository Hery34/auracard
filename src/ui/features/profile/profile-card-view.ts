import type { LinkPlatform } from "@/domain/profile/link";
import type { PublicProfile } from "@/domain/profile/profile";
import { initialsOf } from "@/ui/features/profile/initials";
import { GENERIC_PLATFORMS, PLATFORM_NAMES } from "@/ui/features/profile/platform-names";
import { safeEmail } from "@/ui/features/profile/safe-email";
import { safeHttpsHref, type SafeHref } from "@/ui/features/profile/safe-href";
import { scramble, type ScrambledText } from "@/ui/features/profile/scrambled-text";

/** Revealed on click only: `href` and `text` never reach the HTML in clear; `text: null` keeps the control's label. */
export type ProtectedContact = { href: ScrambledText; text: ScrambledText | null; external: boolean };

type LinkLabel = { platform: LinkPlatform; title: string; subtitle: string | null };

export type ProfileLinkView =
  | (LinkLabel & { kind: "anchor"; href: string })
  | (LinkLabel & { kind: "protected"; contact: ProtectedContact });

export type ProfileCardView = {
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  vcardHref: string;
  phone: ProtectedContact | null;
  email: ProtectedContact | null;
  website: SafeHref | null;
  links: ProfileLinkView[];
};

/** Platforms whose URL carries a phone number: protected like the phone itself. */
const PROTECTED_PLATFORMS: ReadonlySet<LinkPlatform> = new Set(["whatsapp"]);

const PHONE_SEPARATORS = /[\s.()-]/g;

export function toProfileCardView(profile: PublicProfile): ProfileCardView {
  const email = safeEmail(profile.contactEmail);
  return {
    displayName: profile.displayName,
    initials: initialsOf(profile.displayName),
    avatarUrl: safeHttpsHref(profile.avatarUrl)?.href ?? null,
    jobTitle: profile.jobTitle,
    company: profile.company,
    bio: profile.bio,
    vcardHref: `/v/${encodeURIComponent(profile.slug)}`,
    phone: profile.phone === null ? null : protect(`tel:${profile.phone.replace(PHONE_SEPARATORS, "")}`, profile.phone),
    email: email === null ? null : protect(`mailto:${email}`, email),
    website: safeHttpsHref(profile.websiteUrl),
    links: [...profile.links]
      .sort((first, second) => first.position - second.position)
      .flatMap((link) => {
        const safe = safeHttpsHref(link.url);
        return safe === null ? [] : [toLinkView(link.platform, safe.href, link.label)];
      }),
  };
}

function toLinkView(platform: LinkPlatform, href: string, label: string | null): ProfileLinkView {
  const name = PLATFORM_NAMES[platform];
  const view: LinkLabel = {
    platform,
    title: label ?? name,
    subtitle: label !== null && !GENERIC_PLATFORMS.has(platform) ? name : null,
  };
  if (PROTECTED_PLATFORMS.has(platform)) {
    return { ...view, kind: "protected", contact: { href: scramble(href), text: null, external: true } };
  }
  return { ...view, kind: "anchor", href };
}

function protect(href: string, text: string): ProtectedContact {
  return { href: scramble(href), text: scramble(text), external: false };
}

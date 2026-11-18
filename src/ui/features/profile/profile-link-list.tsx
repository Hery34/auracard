import { beaconAttributes, linkTarget } from "@/ui/features/analytics/beacon-target";
import { ContactReveal } from "@/ui/features/profile/contact-reveal";
import { PlatformIcon } from "@/ui/features/profile/icons/platform-icon";
import { LINK_ROW_CLASS } from "@/ui/features/profile/link-row";
import type { ProfileLinkView } from "@/ui/features/profile/profile-card-view";

/** Stored labels and URLs are untrusted: React text and attributes only, never HTML. */
export function ProfileLinkList({ links }: { links: readonly ProfileLinkView[] }) {
  if (links.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col gap-2">
      {links.map((link, index) => (
        <li key={index}>
          {link.kind === "anchor" ? (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className={LINK_ROW_CLASS}
              {...beaconAttributes(linkTarget(link.id))}
            >
              <LinkContent link={link} />
            </a>
          ) : (
            <ContactReveal contact={link.contact} beacon={linkTarget(link.id)}>
              <LinkContent link={link} />
            </ContactReveal>
          )}
        </li>
      ))}
    </ul>
  );
}

function LinkContent({ link }: { link: ProfileLinkView }) {
  return (
    <>
      <PlatformIcon platform={link.platform} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{link.title}</span>
        {link.subtitle !== null && <span className="text-sm text-muted-foreground">{link.subtitle}</span>}
      </span>
    </>
  );
}

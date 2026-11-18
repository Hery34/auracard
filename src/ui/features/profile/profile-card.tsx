import { CONTACT_TARGET, beaconAttributes } from "@/ui/features/analytics/beacon-target";
import { ContactReveal } from "@/ui/features/profile/contact-reveal";
import { InAppBrowserNotice } from "@/ui/features/profile/in-app-browser-notice";
import { ProfileAvatar } from "@/ui/features/profile/profile-avatar";
import { ProfileBanner, ProfileLogo } from "@/ui/features/profile/profile-media";
import type { ProfileCardView } from "@/ui/features/profile/profile-card-view";
import { ProfileLinkList } from "@/ui/features/profile/profile-link-list";
import { scramble } from "@/ui/features/profile/scrambled-text";
import { VCardDownload } from "@/ui/features/profile/vcard-download";

/** Public profile as visitors see it; reused by the editor preview (0020). */
export function ProfileCard({ view }: { view: ProfileCardView }) {
  return (
    <article className="flex flex-col gap-6">
      {view.bannerUrl !== null && <ProfileBanner src={view.bannerUrl} />}
      <header className="flex flex-col items-center gap-2 text-center">
        <ProfileAvatar avatarUrl={view.avatarUrl} initials={view.initials} />
        <h1 className="text-2xl font-semibold text-foreground">{view.displayName}</h1>
        {view.jobTitle !== null && <p className="text-muted-foreground">{view.jobTitle}</p>}
        {view.company !== null && <p className="font-medium text-muted-foreground">{view.company}</p>}
        {view.logoUrl !== null && <ProfileLogo src={view.logoUrl} company={view.company} />}
        {view.bio !== null && <p className="whitespace-pre-line text-foreground">{view.bio}</p>}
      </header>

      <div className="flex flex-col gap-3">
        <InAppBrowserNotice />
        <VCardDownload
          href={scramble(view.vcardHref)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Ajouter aux contacts
        </VCardDownload>
      </div>

      {(view.phone !== null || view.email !== null || view.website !== null) && (
        <ul className="flex flex-col gap-2">
          {view.phone !== null && (
            <li>
              <ContactReveal contact={view.phone} beacon={CONTACT_TARGET}>Appeler</ContactReveal>
            </li>
          )}
          {view.email !== null && (
            <li>
              <ContactReveal contact={view.email} beacon={CONTACT_TARGET}>Écrire un e-mail</ContactReveal>
            </li>
          )}
          {view.website !== null && (
            <li>
              <a
                href={view.website.href}
                target="_blank"
                rel="noopener noreferrer"
                {...beaconAttributes(CONTACT_TARGET)}
                className="inline-flex min-h-11 items-center px-1 font-medium text-link underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring"
              >
                {view.website.host}
              </a>
            </li>
          )}
        </ul>
      )}

      <ProfileLinkList links={view.links} />
    </article>
  );
}

/* eslint-disable @next/next/no-img-element -- `images.unoptimized: true` (docs/rules/nextjs.md): files are resized in the browser before upload (0021), next/image would add nothing but client JavaScript */

/** Decorative: the banner carries no information of its own. */
export function ProfileBanner({ src }: { src: string }) {
  return <img src={src} alt="" width={1500} height={500} className="aspect-[3/1] w-full rounded-xl object-cover" />;
}

/** Fixed box, whatever the logo's ratio: no layout shift while it loads. */
export function ProfileLogo({ src, company }: { src: string; company: string | null }) {
  return <img src={src} alt={logoAlt(company)} width={160} height={48} className="h-12 w-40 object-contain" />;
}

function logoAlt(company: string | null): string {
  return company === null ? "Logo" : `Logo de ${company}`;
}

import Link from "next/link";

import { LOGO_UNAVAILABLE_HINT } from "@/ui/features/qr/messages";

/** Decision 5: only the profile's logo; without one, the option is disabled and points to the profile editor. */
export function LogoOption({ available, defaultChecked }: { available: boolean; defaultChecked: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base font-medium has-disabled:cursor-not-allowed has-disabled:opacity-70">
        <input
          type="checkbox"
          name="logo"
          disabled={!available}
          defaultChecked={available && defaultChecked}
          className="size-5 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed"
        />
        Ajouter mon logo au centre
      </label>
      {!available && (
        <p className="text-sm text-muted-foreground">
          {LOGO_UNAVAILABLE_HINT}{" "}
          <Link
            href="/tableau-de-bord/profil"
            className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4"
          >
            Ajouter un logo à mon profil
          </Link>
        </p>
      )}
    </div>
  );
}

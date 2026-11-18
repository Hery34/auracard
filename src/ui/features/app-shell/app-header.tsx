import Link from "next/link";

import { Logo } from "@/ui/primitives/logo";

export function AppHeader() {
  return (
    <header className="flex items-center justify-between px-4">
      <Link href="/" aria-label="AuraCard" className="inline-flex min-h-11 items-center">
        <Logo className="h-6 sm:h-7" />
      </Link>
      <Link href="/tableau-de-bord" prefetch={false} className="inline-flex min-h-11 items-center underline">
        Mon espace
      </Link>
    </header>
  );
}

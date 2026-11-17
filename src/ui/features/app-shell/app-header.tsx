import Link from "next/link";

export function AppHeader() {
  return (
    <header className="flex items-center justify-between px-4">
      <Link href="/" aria-label="AuraCard" className="inline-flex min-h-11 items-center font-semibold tracking-wide">
        <span>AURA</span>
        <span className="text-primary">CARD</span>
      </Link>
      <Link href="/tableau-de-bord" prefetch={false} className="inline-flex min-h-11 items-center underline">
        Mon espace
      </Link>
    </header>
  );
}

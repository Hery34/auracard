import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "carnet" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <header className="flex items-center justify-between px-4">
          <Link href="/" className="inline-flex min-h-11 items-center font-semibold">
            carnet
          </Link>
          <Link href="/tableau-de-bord" prefetch={false} className="inline-flex min-h-11 items-center underline">
            Mon espace
          </Link>
        </header>
        {children}
      </body>
    </html>
  );
}

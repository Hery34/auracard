import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const montserrat = Montserrat({ subsets: ["latin"], display: "swap", variable: "--font-montserrat" });

export const metadata: Metadata = { title: { default: "AuraCard", template: "%s · AuraCard" } };

// themeColor must stay equal to --background in globals.css.
export const viewport: Viewport = { themeColor: "#0A0A0C" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={montserrat.variable}>
      <body className="font-sans">
        <header className="flex items-center justify-between px-4">
          <Link href="/" aria-label="AuraCard" className="inline-flex min-h-11 items-center font-semibold tracking-wide">
            <span>AURA</span>
            <span className="text-primary">CARD</span>
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

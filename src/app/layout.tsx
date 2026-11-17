import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({ subsets: ["latin"], display: "swap", variable: "--font-montserrat" });

export const metadata: Metadata = { title: { default: "AuraCard", template: "%s · AuraCard" } };

// themeColor must stay equal to --background in globals.css.
export const viewport: Viewport = { themeColor: "#0A0A0C" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={montserrat.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}

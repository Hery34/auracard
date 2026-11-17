import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createContainer } from "@/server/container";
import { ProvisionalDomainNotice } from "@/ui/features/qr/provisional-domain-notice";
import { QrStyleForm } from "@/ui/features/qr/qr-style-form";

export const metadata: Metadata = { title: "Mon QR code" };

/** Session checked here, independently of `src/proxy.ts`; the QR is created on first display (`ensure_qr_code`). */
export default async function MyQrCodePage() {
  const { getOwnQrCode, qrPrintReady } = await createContainer();
  const result = await getOwnQrCode();
  if (!result.ok) {
    if (result.error === "unauthenticated" || result.error === "no_profile") {
      redirect("/connexion");
    }
    throw new Error("my QR code: unavailable");
  }
  const { url, style, logoUrl } = result.value;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Mon QR code</h1>
      {!qrPrintReady && <ProvisionalDomainNotice />}
      <dl className="flex flex-col gap-1">
        <dt className="text-sm text-muted-foreground">Adresse encodée</dt>
        <dd className="text-lg break-all">{url}</dd>
      </dl>
      <QrStyleForm style={style} logoAvailable={logoUrl !== null} />
      <Link href="/tableau-de-bord" className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4">
        Retour au tableau de bord
      </Link>
    </main>
  );
}

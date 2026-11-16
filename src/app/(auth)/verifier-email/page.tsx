import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Vérifiez votre adresse" };

export default function CheckEmailPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Vérifiez votre adresse e-mail</h1>
      <p>
        Un lien de confirmation vient de vous être envoyé. Consultez votre boîte de réception (et le dossier des
        indésirables), puis suivez le lien pour activer votre compte.
      </p>
      <p>
        <Link href="/connexion" className="inline-flex min-h-11 items-center font-medium underline">
          Aller à la connexion
        </Link>
      </p>
    </>
  );
}

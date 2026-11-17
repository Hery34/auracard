import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createContainer } from "@/server/container";
import { toEditorFields, toEditorImages, toEditorLinks } from "@/ui/features/profile-editor/editor-state";
import { ProfileEditor } from "@/ui/features/profile-editor/profile-editor";

export const metadata: Metadata = { title: "Modifier mon profil" };

/** Session checked here, independently of `src/proxy.ts`; the client receives the editable fields only. */
export default async function ProfileEditorPage() {
  const { getOwnProfile } = await createContainer();
  const result = await getOwnProfile();
  if (!result.ok) {
    if (result.error === "unauthenticated") {
      redirect("/connexion");
    }
    throw new Error("profile editor: profile unavailable");
  }
  const { profile, links } = result.value;
  if (profile === null) {
    redirect("/connexion");
  }
  const publicPath = `/p/${profile.slug}`;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Modifier mon profil</h1>
        <p className="text-muted-foreground">
          Adresse publique (non modifiable) :{" "}
          <Link
            href={publicPath}
            prefetch={false}
            className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-4"
          >
            {publicPath}
          </Link>
        </p>
      </header>
      <ProfileEditor
        slug={profile.slug}
        initialFields={toEditorFields(profile)}
        initialLinks={toEditorLinks(links)}
        initialImages={toEditorImages(profile)}
      />
    </main>
  );
}

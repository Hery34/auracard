import type { EditorFields, EditorLink } from "@/ui/features/profile-editor/editor-state";
import { toPreviewProfile } from "@/ui/features/profile-editor/editor-state";
import { ProfileCard } from "@/ui/features/profile/profile-card";
import { toProfileCardView } from "@/ui/features/profile/profile-card-view";

type Props = { slug: string; fields: EditorFields; links: readonly EditorLink[]; className?: string };

/** The public card (0018) built in the browser from the unsaved form, in a phone-width frame; inert: nothing to follow or download. */
export function EditorPreview({ slug, fields, links, className }: Props) {
  const view = toProfileCardView(toPreviewProfile(slug, fields, links));
  return (
    <section aria-label="Aperçu" className={className}>
      <div inert className="mx-auto w-full max-w-[400px] rounded-[2rem] border border-border px-4 py-8">
        <ProfileCard view={view} />
      </div>
    </section>
  );
}

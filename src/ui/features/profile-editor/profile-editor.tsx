"use client";

import { useState } from "react";

import type { EditorFields, EditorLink } from "@/ui/features/profile-editor/editor-state";
import { EditorPreview } from "@/ui/features/profile-editor/editor-preview";
import { LinkFields } from "@/ui/features/profile-editor/link-fields";
import { PanelSwitch, type Panel } from "@/ui/features/profile-editor/panel-switch";
import { ProfileFields } from "@/ui/features/profile-editor/profile-fields";
import { SaveFeedback } from "@/ui/features/profile-editor/save-feedback";
import { useProfileEditor } from "@/ui/features/profile-editor/use-profile-editor";
import { Button } from "@/ui/primitives/button";

type Props = { slug: string; initialFields: EditorFields; initialLinks: readonly EditorLink[] };

/** Client leaf of `/tableau-de-bord/profil`: form and live preview share the same state. */
export function ProfileEditor({ slug, initialFields, initialLinks }: Props) {
  const editor = useProfileEditor(initialFields, initialLinks);
  const [panel, setPanel] = useState<Panel>("edit");

  return (
    <div className="flex flex-col gap-6">
      <PanelSwitch active={panel} onChange={setPanel} />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-10">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            editor.save();
          }}
          className={`${panel === "edit" ? "flex" : "hidden"} flex-col gap-8 lg:flex`}
        >
          <ProfileFields fields={editor.fields} errors={editor.errors.profile} onChange={editor.setField} />
          <LinkFields links={editor.links} errors={editor.errors.links} listError={editor.errors.list} actions={editor.linkActions} />
          <div className="flex flex-col gap-3">
            <SaveFeedback outcome={editor.outcome} />
            <Button type="submit" disabled={editor.pending} className="self-start">
              Enregistrer
            </Button>
          </div>
        </form>
        <EditorPreview
          slug={slug}
          fields={editor.fields}
          links={editor.links}
          className={`${panel === "preview" ? "block" : "hidden"} lg:sticky lg:top-8 lg:block`}
        />
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { replaceLinksAction, updateProfileAction, type ProfileActionError } from "@/server/actions/profile";
import type { EditorFields, EditorLink } from "@/ui/features/profile-editor/editor-state";
import type { LinkActions } from "@/ui/features/profile-editor/link-fields";
import { addLink, moveLink, removeLink, updateLink, withSavedIds } from "@/ui/features/profile-editor/link-list";
import { NO_FIELD_ERRORS, toFieldErrors, type FieldErrors } from "@/ui/features/profile-editor/messages";
import { toLinksFormData, toProfileFormData } from "@/ui/features/profile-editor/serialize";

const SIGN_IN_PATH = "/connexion";
const IDLE = { status: "idle" } as const;

export type SaveOutcome =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; error: Exclude<ProfileActionError, "unauthenticated">; profileKept: boolean };

type ActionFailure = { status: "error"; error: ProfileActionError; fields?: Record<string, string> };

/** Form state, link list operations and the save sequence: profile first, then the full link list. */
export function useProfileEditor(initialFields: EditorFields, initialLinks: readonly EditorLink[]) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [links, setLinks] = useState<readonly EditorLink[]>(initialLinks);
  const [errors, setErrors] = useState<FieldErrors>(NO_FIELD_ERRORS);
  const [outcome, setOutcome] = useState<SaveOutcome>(IDLE);
  const [pending, startTransition] = useTransition();
  const nextKey = useRef(0);

  function setField<K extends keyof EditorFields>(name: K, value: EditorFields[K]) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  const linkActions: LinkActions = {
    add: () => {
      nextKey.current += 1;
      const key = `new-${nextKey.current}`;
      setLinks((current) => addLink(current, key));
      return key;
    },
    update: (key, patch) => setLinks((current) => updateLink(current, key, patch)),
    remove: (key) => setLinks((current) => removeLink(current, key)),
    move: (key, offset) => setLinks((current) => moveLink(current, key, offset)),
  };

  function fail(failure: ActionFailure, sent: readonly EditorLink[], profileKept: boolean) {
    if (failure.error === "unauthenticated") {
      router.replace(SIGN_IN_PATH);
      return;
    }
    setErrors(failure.error === "invalid_input" ? toFieldErrors(failure.fields, sent.map((link) => link.key)) : NO_FIELD_ERRORS);
    setOutcome({ status: "error", error: failure.error, profileKept });
  }

  function save() {
    const sent = links;
    setOutcome(IDLE);
    startTransition(async () => {
      let profileKept = false;
      try {
        const profile = await updateProfileAction(IDLE, toProfileFormData(fields));
        if (profile.status === "error") {
          fail(profile, sent, profileKept);
          return;
        }
        profileKept = true;
        const saved = await replaceLinksAction(IDLE, toLinksFormData(sent));
        if (saved.status === "error") {
          fail(saved, sent, profileKept);
          return;
        }
        if (saved.status === "saved") {
          setLinks((current) => withSavedIds(current, sent, saved.links));
        }
        setErrors(NO_FIELD_ERRORS);
        setOutcome({ status: "saved" });
      } catch {
        // Action threw: network, server error or action not found after a redeploy; the input is kept.
        setOutcome({ status: "error", error: "unexpected", profileKept });
      }
    });
  }

  return { fields, setField, links, linkActions, errors, outcome, pending, save };
}

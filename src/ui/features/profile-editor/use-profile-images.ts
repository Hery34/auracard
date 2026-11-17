"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { ProfileImageKind } from "@/domain/profile/profile-image";
import {
  removeProfileImageAction,
  uploadProfileImageAction,
  type ProfileImageActionError,
  type ProfileImageState,
} from "@/server/actions/profile-image";
import type { EditorImages } from "@/ui/features/profile-editor/editor-state";
import { reencodeImage } from "@/ui/features/profile-editor/image-encoding";

const SIGN_IN_PATH = "/connexion";
const IDLE = { status: "idle" } as const;

export const IMAGE_URL_FIELDS: Readonly<Record<ProfileImageKind, keyof EditorImages>> = {
  avatar: "avatarUrl",
  banner: "bannerUrl",
  logo: "logoUrl",
};

export type ImageStatus = { pending: boolean; error: Exclude<ProfileImageActionError, "unauthenticated"> | null };

const READY: ImageStatus = { pending: false, error: null };

/** Stored images and the state of each control; the last request of a kind wins over an earlier, slower one. */
export function useProfileImages(initialImages: EditorImages) {
  const router = useRouter();
  const [images, setImages] = useState(initialImages);
  const [statuses, setStatuses] = useState<Record<ProfileImageKind, ImageStatus>>({ avatar: READY, banner: READY, logo: READY });
  const latest = useRef<Record<ProfileImageKind, number>>({ avatar: 0, banner: 0, logo: 0 });

  async function run(kind: ProfileImageKind, request: () => Promise<ProfileImageState>) {
    latest.current[kind] += 1;
    const ticket = latest.current[kind];
    setStatuses((current) => ({ ...current, [kind]: { pending: true, error: null } }));
    let state: ProfileImageState;
    try {
      state = await request();
    } catch {
      state = { status: "error", error: "unexpected" };
    }
    if (ticket !== latest.current[kind]) {
      return;
    }
    if (state.status === "error") {
      if (state.error === "unauthenticated") {
        router.replace(SIGN_IN_PATH);
        return;
      }
      const error = state.error;
      setStatuses((current) => ({ ...current, [kind]: { pending: false, error } }));
      return;
    }
    if (state.status === "saved") {
      const url = state.url;
      setImages((current) => ({ ...current, [IMAGE_URL_FIELDS[kind]]: url }));
    }
    setStatuses((current) => ({ ...current, [kind]: READY }));
  }

  function upload(kind: ProfileImageKind, file: File) {
    void run(kind, async () => {
      const encoded = await reencodeImage(file, kind);
      if (encoded === null) {
        return { status: "error", error: "invalid_file" };
      }
      const data = new FormData();
      data.set("kind", kind);
      data.set("file", encoded.blob, `${kind}.${encoded.extension}`);
      return uploadProfileImageAction(IDLE, data);
    });
  }

  function remove(kind: ProfileImageKind) {
    void run(kind, () => {
      const data = new FormData();
      data.set("kind", kind);
      return removeProfileImageAction(IDLE, data);
    });
  }

  return { images, statuses, upload, remove };
}

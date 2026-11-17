"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { textFields } from "@/server/actions/form-fields";
import { saveQrStyleSchema } from "@/server/actions/qr-schemas";
import { createContainer } from "@/server/container";
import type { SaveQrStyleError } from "@/server/use-cases/save-qr-style";

export type SaveQrStyleActionError = "invalid_input" | Exclude<SaveQrStyleError, "unauthenticated">;

export type SaveQrStyleState = { status: "idle" } | { status: "error"; error: SaveQrStyleActionError } | { status: "saved" };

const QR_PATH = "/tableau-de-bord/qr";
const SIGN_IN_PATH = "/connexion";

/** Fields `fg`, `bg` and the checkbox `logo`; replayable (identical style → saved, nothing written). */
export async function saveQrStyleAction(_previous: SaveQrStyleState, formData: FormData): Promise<SaveQrStyleState> {
  const parsed = saveQrStyleSchema.safeParse(textFields(formData, ["fg", "bg", "logo"]));
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  const { saveQrStyle } = await createContainer();
  const result = await saveQrStyle(parsed.data);
  if (!result.ok) {
    if (result.error === "unauthenticated") {
      redirect(SIGN_IN_PATH);
    }
    return { status: "error", error: result.error };
  }
  revalidatePath(QR_PATH);
  return { status: "saved" };
}

"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";

import { isActivationPath } from "@/domain/nfc/activation-path";
import { registerSchema, signInSchema } from "@/server/actions/auth-schemas";
import { textFields } from "@/server/actions/form-fields";
import { deleteSessionCookies } from "@/server/actions/session-cookies";
import { createContainer } from "@/server/container";
import { requestClientAddress } from "@/server/infrastructure/request-client-address";
import type { RegisterUserError } from "@/server/use-cases/register-user";
import type { SignInUseCaseError } from "@/server/use-cases/sign-in";

export type ActionState =
  | { status: "idle" }
  | {
      status: "error";
      error: RegisterUserError | SignInUseCaseError | "invalid_input";
      fields?: Record<string, string>;
    }
  | { status: "check_email" };

const DASHBOARD_PATH = "/tableau-de-bord";
const SIGN_IN_PATH = "/connexion";

/** Public action: no session is required. */
export async function registerAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = registerSchema.safeParse(textFields(formData, ["email", "password", "displayName"]));
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  const { registerUser } = await createContainer();
  const result = await registerUser({ ...parsed.data, clientAddress: await clientAddress() });
  if (!result.ok) {
    return { status: "error", error: result.error };
  }
  if (result.value.needsEmailConfirmation) {
    return { status: "check_email" };
  }
  redirect(DASHBOARD_PATH);
}

/**
 * Public action: no session is required; `displayName` is asked only when the account has to join carnet. The optional
 * field `suivant` is followed only when it is an activation path (allow-list), else the dashboard.
 */
export async function signInAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(textFields(formData, ["email", "password", "displayName"]));
  if (!parsed.success) {
    return invalidInput(parsed.error);
  }
  const { signIn } = await createContainer();
  const result = await signIn({ ...parsed.data, clientAddress: await clientAddress() });
  if (!result.ok) {
    return { status: "error", error: result.error };
  }
  const next = formData.get("suivant");
  redirect(isActivationPath(next) ? next : DASHBOARD_PATH);
}

export async function signOutAction(): Promise<void> {
  const { auth } = await createContainer();
  const result = await auth.signOut();
  if (!result.ok) {
    await deleteSessionCookies();
  }
  redirect(SIGN_IN_PATH, "replace");
}

function invalidInput(error: z.ZodError): ActionState {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    fields[issue.path.map(String).join(".")] ??= issue.message;
  }
  return { status: "error", error: "invalid_input", fields };
}

async function clientAddress(): Promise<string> {
  return requestClientAddress(await headers());
}

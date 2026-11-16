"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";

import { registerSchema, signInSchema } from "@/server/actions/auth-schemas";
import { createContainer } from "@/server/container";
import { clientAddressFrom } from "@/server/infrastructure/client-address";
import { env } from "@/server/infrastructure/env";
import { logWarning } from "@/server/infrastructure/logger";
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

/** Traefik (EasyPanel) is the only proxy in front of Next.js: it sets the last `x-forwarded-for` element. */
const TRUSTED_PROXY_HOPS = 1;

/** Fixed bucket returned by `clientAddressFrom` in production when the header is absent or invalid. */
const UNKNOWN_ADDRESS = "unknown";

const DASHBOARD_PATH = "/tableau-de-bord";
const SIGN_IN_PATH = "/connexion";

/** Prefix of the Supabase session cookies, chunks (`.0`, `.1`…) included. */
const SESSION_COOKIE_PREFIX = "sb-";

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

/** Public action: no session is required; `displayName` is asked only when the account has to join carnet. */
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
  redirect(DASHBOARD_PATH);
}

export async function signOutAction(): Promise<void> {
  const { auth } = await createContainer();
  const result = await auth.signOut();
  if (!result.ok) {
    await deleteSessionCookies();
  }
  redirect(SIGN_IN_PATH, "replace");
}

async function deleteSessionCookies(): Promise<void> {
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (name.startsWith(SESSION_COOKIE_PREFIX)) {
      store.delete(name);
    }
  }
}

function textFields(formData: FormData, names: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(
    names.map((name) => {
      const value = formData.get(name);
      return [name, typeof value === "string" ? value : undefined];
    }),
  );
}

function invalidInput(error: z.ZodError): ActionState {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    fields[issue.path.map(String).join(".")] ??= issue.message;
  }
  return { status: "error", error: "invalid_input", fields };
}

async function clientAddress(): Promise<string> {
  const address = clientAddressFrom(await headers(), {
    trustedProxyHops: TRUSTED_PROXY_HOPS,
    production: env.NODE_ENV === "production",
  });
  if (address === UNKNOWN_ADDRESS) {
    logWarning("client-address", "unknown_address");
  }
  return address;
}

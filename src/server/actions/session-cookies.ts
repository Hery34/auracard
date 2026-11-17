import { cookies } from "next/headers";

/** Prefix of the Supabase session cookies, chunks (`.0`, `.1`…) included. */
const SESSION_COOKIE_PREFIX = "sb-";

/** Deletes every Supabase session cookie of the request, the others kept. */
export async function deleteSessionCookies(): Promise<void> {
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (name.startsWith(SESSION_COOKIE_PREFIX)) {
      store.delete(name);
    }
  }
}

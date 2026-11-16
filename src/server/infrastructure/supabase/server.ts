import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/server/infrastructure/env";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";
import { SESSION_COOKIE_OPTIONS } from "@/server/infrastructure/supabase/cookie-options";
import type { Database } from "@/server/infrastructure/supabase/database.types";

/** Anonymous-key client carrying the session of the request cookies: one instance per request. */
export async function createServerSupabaseClient(): Promise<CarnetClient> {
  const cookieStore = await cookies();

  return createServerClient<Database, "carnet">(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: "carnet" },
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A Server Component cannot write cookies; the session is refreshed by the proxy there.
        }
      },
    },
  });
}

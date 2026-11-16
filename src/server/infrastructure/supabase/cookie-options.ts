import type { CookieOptions } from "@supabase/ssr";

import { env } from "@/server/infrastructure/env";

/**
 * Attributes of the session cookies, shared by `server.ts` and `src/proxy.ts` so both write the same
 * cookies. No browser Supabase client in this project: the session stays out of reach of scripts.
 */
export const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
};

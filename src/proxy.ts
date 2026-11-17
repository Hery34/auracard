import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/server/infrastructure/env";
import { SESSION_COOKIE_OPTIONS } from "@/server/infrastructure/supabase/cookie-options";

const SIGN_IN_PATH = "/connexion";

/**
 * Comfort only, every page checks again: refreshes the session cookies and sends a visitor without a
 * session from the dashboard to the sign-in page (navigations only). Nothing is protected here (`docs/rules/nextjs.md`).
 * No reverse redirection: a signed-in account without a profile must still reach `/connexion`.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // The render behind this proxy reads the refreshed cookies; the browser receives them with the response.
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // getUser() asks GoTrue, which refreshes an expired token; getSession() would trust the cookie as is.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A Server Action (always a POST with `Next-Action`) checks the session itself and answers `unauthenticated`;
  // a redirect would break its response. Any other request without a session, a GET included, is redirected.
  const isServerAction = request.method === "POST" && request.headers.has("next-action");
  if (user === null && !isServerAction) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = SIGN_IN_PATH;
    signIn.search = "";
    const redirect = NextResponse.redirect(signIn);
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}

export const config = {
  matcher: ["/tableau-de-bord/:path*"],
};

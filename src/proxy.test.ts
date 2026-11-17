/**
 * Contract frozen by test-engineer (0020, decision 11; criterion 4).
 *
 * // src/proxy.ts — comfort only, every page and every action checks the session again.
 * //   Without a session: a navigation under /tableau-de-bord is redirected to /connexion;
 * //   a request carrying the `Next-Action` header (Server Action) is NOT redirected: it reaches the action,
 * //   which answers `unauthenticated`, and the editor sends the visitor to /connexion.
 * //   Decision 12: the exception only holds for `POST`; a `GET` carrying `Next-Action` is redirected like any navigation.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { stubValidEnv } from "../tests/builders/env";
import { aGoTrueUser, type GoTrueUser } from "../tests/builders/fake-supabase-auth";

type RefreshedCookie = { name: string; value: string; options: Record<string, unknown> };
type CookieAdapter = { cookies: { setAll: (cookies: RefreshedCookie[], headers: Record<string, string>) => void } };

const mocks = vi.hoisted(() => ({
  user: null as GoTrueUser | null,
  /** Cookies GoTrue hands back while getUser() refreshes an expired token (null: nothing refreshed). */
  refreshed: null as RefreshedCookie[] | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: CookieAdapter) => ({
    auth: {
      getUser: async () => {
        if (mocks.refreshed !== null) {
          options.cookies.setAll(mocks.refreshed, { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" });
        }
        return { data: { user: mocks.user }, error: null };
      },
    },
  }),
}));

const EDITOR_URL = "http://localhost:3000/tableau-de-bord/profil";
const ACTION_ID = "7f3a9c0e5b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a";

let proxyModule: typeof import("@/proxy");

beforeAll(async () => {
  stubValidEnv();
  proxyModule = await import("@/proxy");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  mocks.user = null;
  mocks.refreshed = null;
});

function navigation(): NextRequest {
  return new NextRequest(EDITOR_URL, { method: "GET", headers: { accept: "text/html" } });
}

function serverAction(): NextRequest {
  return new NextRequest(EDITOR_URL, {
    method: "POST",
    headers: { "Next-Action": ACTION_ID, accept: "text/x-component", "content-type": "multipart/form-data; boundary=x" },
    body: "--x--",
  });
}

function getWithActionHeader(): NextRequest {
  return new NextRequest(EDITOR_URL, { method: "GET", headers: { "Next-Action": ACTION_ID, accept: "text/html" } });
}

function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

describe("proxy", () => {
  it("criterion 4 (page): a navigation to /tableau-de-bord/profil without a session is redirected to /connexion", async () => {
    const response = await proxyModule.proxy(navigation());

    expect(isRedirect(response)).toBe(true);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/connexion");
  });

  it("criterion 4 (action), decision 11: a Server Action (Next-Action header) without a session is not redirected, it reaches the action", async () => {
    const response = await proxyModule.proxy(serverAction());

    expect(isRedirect(response)).toBe(false);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("decision 12: a GET carrying Next-Action without a session is redirected to /connexion (the exception only holds for POST)", async () => {
    const response = await proxyModule.proxy(getWithActionHeader());

    expect(isRedirect(response)).toBe(true);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/connexion");
  });

  it("a navigation with a session goes on to the page", async () => {
    mocks.user = aGoTrueUser();

    const response = await proxyModule.proxy(navigation());

    expect(isRedirect(response)).toBe(false);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("0025 decision 13: applies to the dashboard and to /activer (refresh only), nothing else", () => {
    expect([...proxyModule.config.matcher].sort()).toStrictEqual(["/activer/:path*", "/tableau-de-bord/:path*"]);
  });
});

/**
 * Contract frozen by test-engineer (0025, decision 13): `/activer/{uid}` reads the session in a Server Component, so the
 * proxy refreshes it there too, but never redirects: a visitor without a session must see « Connectez-vous pour
 * activer cette carte ». `/tableau-de-bord` keeps its redirection.
 */
describe("proxy — /activer (0025, decision 13)", () => {
  const ACTIVATION_URL = "http://localhost:3000/activer/7k2m9p4q8r3s";
  const REFRESHED: RefreshedCookie[] = [
    { name: "sb-127-auth-token", value: "base64-refreshed-session", options: { path: "/", httpOnly: true, sameSite: "lax" } },
  ];

  function activationNavigation(): NextRequest {
    return new NextRequest(ACTIVATION_URL, { method: "GET", headers: { accept: "text/html" } });
  }

  it("without a session → no redirection, the request goes on to the page (next)", async () => {
    const response = await proxyModule.proxy(activationNavigation());

    expect(isRedirect(response)).toBe(false);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("with a session whose token was refreshed → next, the refreshed cookies are set on the response and on the request", async () => {
    mocks.user = aGoTrueUser();
    mocks.refreshed = REFRESHED;

    const response = await proxyModule.proxy(activationNavigation());

    expect(isRedirect(response)).toBe(false);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get("sb-127-auth-token")?.value).toBe("base64-refreshed-session");
    expect(response.headers.get("x-middleware-override-headers") ?? "").toContain("cookie");
    expect(response.headers.get("x-middleware-request-cookie") ?? "").toContain("base64-refreshed-session");
  });

  it("a session that GoTrue refuses while refreshing (user null) still reaches the page, with the cleared cookies", async () => {
    mocks.refreshed = [{ name: "sb-127-auth-token", value: "", options: { path: "/", maxAge: 0 } }];

    const response = await proxyModule.proxy(activationNavigation());

    expect(isRedirect(response)).toBe(false);
    expect(response.cookies.get("sb-127-auth-token")?.value).toBe("");
  });

  it("/activer without uid nor trailing slash (matched by /activer/:path*), without a session → no redirection, next", async () => {
    const response = await proxyModule.proxy(
      new NextRequest("http://localhost:3000/activer", { method: "GET", headers: { accept: "text/html" } }),
    );

    expect(isRedirect(response)).toBe(false);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/activerX", "/activer-foo"])(
    "%s is not the activation page: without a session → still redirected to /connexion",
    async (pathname) => {
      const response = await proxyModule.proxy(
        new NextRequest(`http://localhost:3000${pathname}`, { method: "GET", headers: { accept: "text/html" } }),
      );

      expect(isRedirect(response)).toBe(true);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/connexion");
    },
  );

  it("the dashboard is unchanged: without a session → /connexion, refreshed cookies carried by the redirection", async () => {
    mocks.refreshed = REFRESHED;

    const response = await proxyModule.proxy(navigation());

    expect(isRedirect(response)).toBe(true);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/connexion");
    expect(response.cookies.get("sb-127-auth-token")?.value).toBe("base64-refreshed-session");
  });
});

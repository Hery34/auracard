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

const mocks = vi.hoisted(() => ({ user: null as GoTrueUser | null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
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

  it("only applies to the dashboard", () => {
    expect(proxyModule.config.matcher).toStrictEqual(["/tableau-de-bord/:path*"]);
  });
});

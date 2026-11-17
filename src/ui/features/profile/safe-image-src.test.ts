/**
 * Contract frozen by test-engineer (0021, decision 5: image URLs revalidated at display time; decision 12: only the
 * configured Supabase origin, stricter than the former `http:` loopback exception).
 *
 * // src/ui/features/profile/safe-image-src.ts — usable in the browser (editor preview) and on the server
 * // mediaOrigin = NEXT_PUBLIC_SUPABASE_URL (an origin without path, enforced by env.ts; trailing slash tolerated).
 * export function safeImageSrc(value: string | null, mediaOrigin: string): string | null;
 * // Accepted only when the parsed URL has exactly the origin of mediaOrigin (scheme, host, port), no credentials, and
 * // a normalized path under `/storage/v1/object/public/carnet-media/` → its normalized href.
 * // Anything else → null: another origin (even loopback or another port), javascript:, data:, blob:,
 * // protocol-relative, credentials, another bucket, a traversal out of the bucket, an unparsable mediaOrigin.
 */
import { describe, expect, it } from "vitest";

import { safeImageSrc } from "@/ui/features/profile/safe-image-src";

const NAME = "c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f/avatar-1a2b3c4d-0000-4000-8000-000000000001.jpg";
const PUBLIC_PATH = "/storage/v1/object/public/carnet-media/";
const ORIGIN = "https://supabase.carnet.example";
const LOCAL_ORIGIN = "http://127.0.0.1:54321";

describe("safeImageSrc — configured Supabase origin only (decision 12)", () => {
  it("null → null", () => {
    expect(safeImageSrc(null, ORIGIN)).toBeNull();
  });

  it("a public URL of carnet-media on the configured origin → kept", () => {
    const url = `${ORIGIN}${PUBLIC_PATH}${NAME}`;

    expect(safeImageSrc(url, ORIGIN)).toBe(url);
  });

  it("a trailing slash on the configured origin changes nothing", () => {
    const url = `${ORIGIN}${PUBLIC_PATH}${NAME}`;

    expect(safeImageSrc(url, `${ORIGIN}/`)).toBe(url);
  });

  it("the local stack over http, when it is the configured origin (E2E and CI) → kept", () => {
    const url = `${LOCAL_ORIGIN}${PUBLIC_PATH}${NAME}`;

    expect(safeImageSrc(url, LOCAL_ORIGIN)).toBe(url);
  });

  it.each([
    ["another https origin", `https://autre.example${PUBLIC_PATH}${NAME}`, ORIGIN],
    ["loopback on another port", `http://127.0.0.1:9999${PUBLIC_PATH}${NAME}`, LOCAL_ORIGIN],
    ["loopback over https on the same port", `https://127.0.0.1:54321${PUBLIC_PATH}${NAME}`, LOCAL_ORIGIN],
    ["localhost while 127.0.0.1 is configured", `http://localhost:54321${PUBLIC_PATH}${NAME}`, LOCAL_ORIGIN],
    ["the local stack while production is configured", `${LOCAL_ORIGIN}${PUBLIC_PATH}${NAME}`, ORIGIN],
    ["http on the configured https host", `http://supabase.carnet.example${PUBLIC_PATH}${NAME}`, ORIGIN],
    ["the configured host on another port", `https://supabase.carnet.example:8443${PUBLIC_PATH}${NAME}`, ORIGIN],
    ["a look-alike host", `https://supabase.carnet.example.evil.example${PUBLIC_PATH}${NAME}`, ORIGIN],
    ["a sub-domain of the configured host", `https://cdn.supabase.carnet.example${PUBLIC_PATH}${NAME}`, ORIGIN],
    ["credentials on the configured origin", `https://user:pw@supabase.carnet.example${PUBLIC_PATH}${NAME}`, ORIGIN],
    ["another bucket of the instance", `${ORIGIN}/storage/v1/object/public/autre-projet/${NAME}`, ORIGIN],
    ["a traversal out of carnet-media", `${ORIGIN}${PUBLIC_PATH}../autre-projet/${NAME}`, ORIGIN],
    ["another API of the configured origin", `${ORIGIN}/auth/v1/user`, ORIGIN],
    ["javascript:", "javascript:alert(1)", ORIGIN],
    ["data:", "data:image/svg+xml,<svg onload=alert(1)>", ORIGIN],
    ["blob:", `blob:${ORIGIN}/1234`, ORIGIN],
    ["protocol-relative", `//supabase.carnet.example${PUBLIC_PATH}${NAME}`, ORIGIN],
    ["a relative path", `${PUBLIC_PATH}${NAME}`, ORIGIN],
    ["an empty string", "", ORIGIN],
    ["an unparsable configured origin", `${ORIGIN}${PUBLIC_PATH}${NAME}`, ""],
  ])("%s → null", (_label, value, mediaOrigin) => {
    expect(safeImageSrc(value, mediaOrigin)).toBeNull();
  });
});

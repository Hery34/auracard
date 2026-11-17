import type { MediaFetcher } from "@/domain/profile/ports";
import { publicMediaUrl } from "@/domain/profile/profile-image";

export const MEDIA_FETCH_TIMEOUT_MS = 3000;
export const MEDIA_FETCH_MAX_BYTES = 1_048_576;

/**
 * Server-side read of a public object of `carnet-media`, on the configured Supabase origin only (no arbitrary URL:
 * SSRF). No redirection followed; the delay covers the whole exchange, the size is counted while reading.
 */
export function makeMediaFetcher(deps: {
  supabaseUrl: string;
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
  maxBytes: number;
}): MediaFetcher {
  const origin = new URL(deps.supabaseUrl).origin;

  return {
    async fetch(url) {
      if (!isAllowed(url, origin)) {
        return null;
      }
      const signal = AbortSignal.timeout(deps.timeoutMs);
      try {
        const response = await deps.fetch(url, { method: "GET", redirect: "error", signal });
        if (!response.ok || response.body === null) {
          return null;
        }
        const declared = Number(response.headers.get("content-length") ?? "0");
        if (declared > deps.maxBytes) {
          await response.body.cancel();
          return null;
        }
        return await readAtMost(response.body, deps.maxBytes, signal);
      } catch {
        return null;
      }
    },
  };
}

function isAllowed(text: string, origin: string): boolean {
  const url = URL.parse(text);
  if (url === null || url.origin !== origin || url.username !== "" || url.password !== "") {
    return false;
  }
  const name = url.pathname.split("/").slice(-2).join("/");
  return text === publicMediaUrl(origin, name);
}

/** A delay elapsed while reading cancels the stream: the pending read ends, the partial body is dropped. */
async function readAtMost(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  signal.addEventListener("abort", () => void reader.cancel().catch(() => undefined), { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (signal.aborted) {
      return null;
    }
    if (done) {
      break;
    }
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

import { parseHttpsUrl } from "@/domain/profile/https-url";

export type SafeHref = { href: string; host: string };

/**
 * Stored URLs are untrusted (direct PostgREST writes, audit 0016): checked again at display time, same rule as
 * the editor. `host` is the ASCII (punycode) host name, the only form shown in clear.
 */
export function safeHttpsHref(value: string | null): SafeHref | null {
  if (value === null) {
    return null;
  }
  const parsed = parseHttpsUrl(value);
  return parsed.ok ? { href: parsed.value.value, host: parsed.value.host } : null;
}

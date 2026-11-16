import { parseHttpsUrl, type HttpsUrl } from "@/domain/profile/https-url";

/** Builds an `HttpsUrl` (normalized `new URL(x).href`) from a literal known to be valid; throws otherwise. */
export function aHttpsUrl(text: string): HttpsUrl {
  const result = parseHttpsUrl(text);
  if (!result.ok) {
    throw new Error(`aHttpsUrl: "${text}" is not a valid https URL (${result.error})`);
  }
  return result.value.value;
}

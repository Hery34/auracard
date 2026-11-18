/**
 * Fetch metadata checks against inflation from third-party pages (0029, point 10). A missing header is accepted:
 * older browsers and non-browser clients do not send it.
 */

/** `siteOrigin` is the configured public origin, never the URL of the request (it differs behind the proxy). */
export function isSameOriginRequest(headers: Headers, siteOrigin: string): boolean {
  const origin = headers.get("origin");
  const site = headers.get("sec-fetch-site");
  return (origin === null || origin === siteOrigin) && (site === null || site === "same-origin");
}

/** A top-level navigation (a scan opened by the phone), not an image, script or frame embedded elsewhere. */
export function isDocumentNavigation(headers: Headers): boolean {
  const destination = headers.get("sec-fetch-dest");
  return destination === null || destination === "document";
}

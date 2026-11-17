const PUBLIC_MEDIA_PATH = "/storage/v1/object/public/carnet-media/";
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["https:", "http:"]);

/**
 * Image URLs are built by the server from the configured Supabase origin, and checked again at display time (0021,
 * decisions 5 and 12): only that exact origin, and only the public path of the `carnet-media` bucket.
 */
export function safeImageSrc(value: string | null, mediaOrigin: string): string | null {
  if (value === null) {
    return null;
  }
  const media = parseUrl(mediaOrigin);
  const url = parseUrl(value);
  if (media === null || url === null || !WEB_PROTOCOLS.has(media.protocol)) {
    return null;
  }
  const accepted =
    url.protocol === media.protocol &&
    url.origin === media.origin &&
    url.username === "" &&
    url.password === "" &&
    url.pathname.startsWith(PUBLIC_MEDIA_PATH);
  return accepted ? url.href : null;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Every answer of `/t/` and `/q/` is neither stored by a cache nor indexed (0025, decision 1). */
const NO_STORE_NO_INDEX = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } as const;

/** One page whatever the cause (unknown, disabled, unpublished, malformed): no oracle. */
const NOT_ACTIVE_PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Carte inactive</title>
</head>
<body>
<main>
<h1>Cette carte n'est pas active.</h1>
</main>
</body>
</html>
`;

/** `Location` is the relative path itself: the browser resolves it on the URL it requested, whatever the proxy. */
export function scanRedirect(path: string): Response {
  return new Response(null, { status: 307, headers: { ...NO_STORE_NO_INDEX, Location: path } });
}

export function scanNotFound(): Response {
  return new Response(NOT_ACTIVE_PAGE, {
    status: 404,
    headers: { ...NO_STORE_NO_INDEX, "Content-Type": "text/html; charset=utf-8" },
  });
}

export function scanFailure(): Response {
  return new Response(null, { status: 500, headers: NO_STORE_NO_INDEX });
}

import { after } from "next/server";

import { createPublicContainer } from "@/server/container";

const STATUS_OF_ERROR = { rate_limited: 429, unexpected: 500 } as const;

/** Every answer, success or not, is neither stored by a cache nor indexed (0019, decision 7). */
const NO_STORE_NO_INDEX = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } as const;

/**
 * Dynamic: the `vcard` rate limit is checked on every request; only the profile read is cached. The
 * `vcard_download` is recorded after the response, its failure changes nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const container = createPublicContainer();
  const result = await container.downloadVCard(slug, request.headers);
  if (!result.ok) {
    return new Response(null, { status: STATUS_OF_ERROR[result.error], headers: NO_STORE_NO_INDEX });
  }
  if (result.value === null) {
    return new Response(null, { status: 404, headers: NO_STORE_NO_INDEX });
  }
  after(() => container.recordServerEvent({ slug, type: "vcard_download" }, request.headers));
  return new Response(result.value.content, {
    headers: {
      ...NO_STORE_NO_INDEX,
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.value.fileName}"`,
    },
  });
}

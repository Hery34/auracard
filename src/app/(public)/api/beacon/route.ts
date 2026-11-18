import { after } from "next/server";
import { z } from "zod";

import { ANALYTICS_SOURCES, BEACON_EVENT_TYPES, UUID_LENGTH } from "@/domain/analytics/analytics-event";
import { SLUG_MAX_LENGTH } from "@/domain/profile/slug";
import { createPublicContainer, siteUrl } from "@/server/container";

import { isSameOriginRequest } from "../../fetch-metadata";

const MAX_BODY_BYTES = 1024;

/** Shape only; the use case checks the uuids, the slug format and the link rule again. */
const beaconSchema = z.strictObject({
  slug: z.string().max(SLUG_MAX_LENGTH),
  id: z.string().max(UUID_LENGTH),
  type: z.enum(BEACON_EVENT_TYPES),
  source: z.enum(ANALYTICS_SOURCES),
  link_id: z.string().max(UUID_LENGTH).optional(),
});

/** One answer whatever happens: no oracle on the existence of a profile, nothing stored, no cookie. */
function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}

/** Text of the body, or null beyond `MAX_BODY_BYTES` (read stops there). sendBeacon posts text/plain. */
async function boundedText(request: Request): Promise<string | null> {
  if (request.body === null) {
    return "";
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Views and clicks of the public page (0029, decision 6). Robots, rate limit and the published profile are checked by
 * the use case after the response; its failures are logged by the adapters, never answered.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request.headers, siteUrl)) {
    return noContent();
  }
  const text = await boundedText(request).catch(() => null);
  if (text === null) {
    return noContent();
  }
  const parsed = beaconSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    return noContent();
  }
  const { link_id, ...event } = parsed.data;
  after(() => createPublicContainer().recordBeaconEvent({ ...event, linkId: link_id ?? null }, request.headers));
  return noContent();
}

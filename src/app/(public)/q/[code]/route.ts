import { after } from "next/server";

import { createPublicContainer } from "@/server/container";

import { isDocumentNavigation } from "../../fetch-metadata";
import { scanFailure, scanNotFound, scanRedirect } from "../../scan-responses";

/** Dynamic: every scan is resolved live; the `qr_scan` is recorded after the response, its failure changes nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const container = createPublicContainer();
  const result = await container.resolveQrCode((await params).code);
  if (!result.ok) {
    return scanFailure();
  }
  if (result.value === null) {
    return scanNotFound();
  }
  const slug = result.value;
  if (isDocumentNavigation(request.headers)) {
    after(() => container.recordServerEvent({ slug, type: "qr_scan" }, request.headers));
  }
  return scanRedirect(`/p/${slug}?s=qr`);
}

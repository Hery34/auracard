import { after } from "next/server";

import { activationPath } from "@/domain/nfc/activation-path";
import { createPublicContainer } from "@/server/container";

import { isDocumentNavigation } from "../../fetch-metadata";
import { scanFailure, scanNotFound, scanRedirect } from "../../scan-responses";

/** Dynamic: every scan is resolved live; the `nfc_scan` is recorded after the response, its failure changes nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ uid: string }> }): Promise<Response> {
  const { uid } = await params;
  const container = createPublicContainer();
  const result = await container.resolveNfcTag(uid);
  if (!result.ok) {
    return scanFailure();
  }
  switch (result.value.state) {
    case "active": {
      const { slug } = result.value;
      if (isDocumentNavigation(request.headers)) {
        after(() => container.recordServerEvent({ slug, type: "nfc_scan" }, request.headers));
      }
      return scanRedirect(`/p/${slug}?s=nfc`);
    }
    case "activation":
      return scanRedirect(activationPath(uid));
    case "not_found":
      return scanNotFound();
  }
}

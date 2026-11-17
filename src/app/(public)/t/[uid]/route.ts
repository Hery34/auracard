import { activationPath } from "@/domain/nfc/activation-path";
import { createPublicContainer } from "@/server/container";

import { scanFailure, scanNotFound, scanRedirect } from "../../scan-responses";

/** Dynamic: every scan is resolved live; no side effect before phase 4 (scan event). */
export async function GET(_request: Request, { params }: { params: Promise<{ uid: string }> }): Promise<Response> {
  const { uid } = await params;
  const result = await createPublicContainer().resolveNfcTag(uid);
  if (!result.ok) {
    return scanFailure();
  }
  switch (result.value.state) {
    case "active":
      return scanRedirect(`/p/${result.value.slug}`);
    case "activation":
      return scanRedirect(activationPath(uid));
    case "not_found":
      return scanNotFound();
  }
}

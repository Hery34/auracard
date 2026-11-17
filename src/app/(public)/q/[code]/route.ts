import { createPublicContainer } from "@/server/container";

import { scanFailure, scanNotFound, scanRedirect } from "../../scan-responses";

/** Dynamic: every scan is resolved live; no side effect before phase 4 (scan event). */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const result = await createPublicContainer().resolveQrCode((await params).code);
  if (!result.ok) {
    return scanFailure();
  }
  if (result.value === null) {
    return scanNotFound();
  }
  return scanRedirect(`/p/${result.value}`);
}

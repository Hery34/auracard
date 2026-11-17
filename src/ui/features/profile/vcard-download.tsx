"use client";

import type { ReactNode } from "react";

import { unscramble, type ScrambledText } from "@/ui/features/profile/scrambled-text";

/**
 * Keeps `/v/{slug}` out of the HTML (0018, decision 10): the link is assembled and followed on click, and
 * `Content-Disposition: attachment` turns it into a download (no `download` attribute: same request as a plain link).
 */
export function VCardDownload({ href, className, children }: { href: ScrambledText; className: string; children: ReactNode }) {
  function download() {
    const anchor = document.createElement("a");
    anchor.href = unscramble(href);
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <button type="button" onClick={download} className={className}>
      {children}
    </button>
  );
}

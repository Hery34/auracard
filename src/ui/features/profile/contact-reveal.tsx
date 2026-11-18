"use client";

import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { beaconAttributes, type BeaconTarget } from "@/ui/features/analytics/beacon-target";
import { LINK_ROW_CLASS } from "@/ui/features/profile/link-row";
import type { ProtectedContact } from "@/ui/features/profile/profile-card-view";
import { unscramble } from "@/ui/features/profile/scrambled-text";

type Revealed = { href: string; text: string | null };

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow ugc" } as const;

/** Anti-scraping leaf: the link is assembled in the browser on the first click, then followed at once. */
export function ContactReveal({
  contact,
  beacon,
  children,
}: {
  contact: ProtectedContact;
  beacon: BeaconTarget;
  children: ReactNode;
}) {
  const tracked = beaconAttributes(beacon);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const anchor = useRef<HTMLAnchorElement>(null);

  function reveal() {
    flushSync(() => setRevealed(decode(contact)));
    anchor.current?.focus();
    anchor.current?.click();
  }

  if (revealed === null) {
    return (
      <button type="button" onClick={reveal} className={LINK_ROW_CLASS} {...tracked}>
        {children}
      </button>
    );
  }
  return (
    <a ref={anchor} href={revealed.href} className={LINK_ROW_CLASS} {...tracked} {...(contact.external ? EXTERNAL : {})}>
      {revealed.text ?? children}
    </a>
  );
}

function decode(contact: ProtectedContact): Revealed {
  return { href: unscramble(contact.href), text: contact.text === null ? null : unscramble(contact.text) };
}

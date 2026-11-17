"use client";

import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { LINK_ROW_CLASS } from "@/ui/features/profile/link-row";
import type { ProtectedContact } from "@/ui/features/profile/profile-card-view";
import { unscramble } from "@/ui/features/profile/scrambled-text";

type Revealed = { href: string; text: string | null };

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow ugc" } as const;

/** Anti-scraping leaf: the link is assembled in the browser on the first click, then followed at once. */
export function ContactReveal({ contact, children }: { contact: ProtectedContact; children: ReactNode }) {
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const anchor = useRef<HTMLAnchorElement>(null);

  function reveal() {
    flushSync(() => setRevealed(decode(contact)));
    anchor.current?.focus();
    anchor.current?.click();
  }

  if (revealed === null) {
    return (
      <button type="button" onClick={reveal} className={LINK_ROW_CLASS}>
        {children}
      </button>
    );
  }
  return (
    <a ref={anchor} href={revealed.href} className={LINK_ROW_CLASS} {...(contact.external ? EXTERNAL : {})}>
      {revealed.text ?? children}
    </a>
  );
}

function decode(contact: ProtectedContact): Revealed {
  return { href: unscramble(contact.href), text: contact.text === null ? null : unscramble(contact.text) };
}

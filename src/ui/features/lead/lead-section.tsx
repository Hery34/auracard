"use client";

import { useId, useState } from "react";

import { LeadForm } from "@/ui/features/lead/lead-form";
import { OPEN_LEAD_FORM_LABEL } from "@/ui/features/lead/messages";
import { Button } from "@/ui/primitives/button";

type Props = { slug: string; ownerName: string; siteKey: string };

/**
 * Folded contact form of the public page (decision 1): nothing but this button in the static HTML; the form, its
 * idempotency key and Cloudflare's script exist only once it is unfolded.
 */
export function LeadSection({ slug, ownerName, siteKey }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section className="mt-8 flex flex-col gap-4">
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {OPEN_LEAD_FORM_LABEL}
      </Button>
      <div id={panelId}>{open && <LeadForm slug={slug} ownerName={ownerName} siteKey={siteKey} />}</div>
    </section>
  );
}

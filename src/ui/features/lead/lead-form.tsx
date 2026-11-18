"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";

import { LEAD_TEXT_MAX_LENGTH } from "@/domain/lead/lead";
import { captureLeadAction, type CaptureLeadState } from "@/server/actions/lead";
import { needsNewChallenge, needsNewIdempotencyKey, toLeadFormView } from "@/ui/features/lead/lead-form-view";
import { LEAD_SENT_MESSAGE, leadConsentLabel, leadPrivacyNotice } from "@/ui/features/lead/messages";
import { useTurnstile } from "@/ui/features/lead/use-turnstile";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Label } from "@/ui/primitives/label";
import { Textarea } from "@/ui/primitives/textarea";

const INITIAL_STATE: CaptureLeadState = { status: "idle" };
const MESSAGE_ID = "lead-message";
const CONSENT_ID = "lead-consent";

type Props = { slug: string; ownerName: string; siteKey: string };
type FormState = { answer: CaptureLeadState; idempotencyKey: string };

async function submitLead(previous: FormState, data: FormData): Promise<FormState> {
  const answer = await captureLeadAction(previous.answer, data);
  return { answer, idempotencyKey: needsNewIdempotencyKey(answer) ? crypto.randomUUID() : previous.idempotencyKey };
}

/**
 * Mounted only once the visitor unfolds it: the idempotency key is drawn here, in the browser. Submitted through a
 * transition rather than `action=` so that React does not clear the typed values when the action refuses them.
 */
export function LeadForm({ slug, ownerName, siteKey }: Props) {
  const [initialState] = useState<FormState>(() => ({ answer: INITIAL_STATE, idempotencyKey: crypto.randomUUID() }));
  const [{ answer: state, idempotencyKey }, dispatch, pending] = useActionState(submitLead, initialState);
  const { containerRef, reset } = useTurnstile(siteKey, slug);
  const view = toLeadFormView(state);

  useEffect(() => {
    if (needsNewChallenge(state)) {
      reset();
    }
  }, [state, reset]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className={view.sent ? "rounded-md border border-border bg-card p-3 text-card-foreground" : "sr-only"}>
        {view.sent ? LEAD_SENT_MESSAGE : ""}
      </p>
      {!view.sent && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {view.alert !== null && (
            <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-foreground">
              {view.alert}
            </p>
          )}
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <Field
            id="lead-name"
            name="name"
            label="Nom"
            type="text"
            autoComplete="name"
            required
            maxLength={LEAD_TEXT_MAX_LENGTH.name}
            error={view.fieldErrors.name}
          />
          <Field
            id="lead-email"
            name="email"
            label="E-mail"
            type="email"
            autoComplete="email"
            required
            maxLength={LEAD_TEXT_MAX_LENGTH.email}
            error={view.fieldErrors.email}
          />
          <MessageField error={view.fieldErrors.message} />
          <ConsentField label={leadConsentLabel(ownerName)} error={view.fieldErrors.consent} />
          <div ref={containerRef} className="min-h-[65px]" />
          <Button type="submit" disabled={pending}>
            Envoyer
          </Button>
          <p className="text-sm text-muted-foreground">{leadPrivacyNotice(ownerName)}</p>
        </form>
      )}
    </div>
  );
}

function MessageField({ error }: { error: string | undefined }) {
  const errorId = `${MESSAGE_ID}-error`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={MESSAGE_ID}>Message</Label>
      <Textarea
        id={MESSAGE_ID}
        name="message"
        required
        rows={5}
        maxLength={LEAD_TEXT_MAX_LENGTH.message}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ConsentField({ label, error }: { label: string; error: string | undefined }) {
  const errorId = `${CONSENT_ID}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={CONSENT_ID} className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
        <input
          id={CONSENT_ID}
          type="checkbox"
          name="consent"
          required
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : errorId}
          className="mt-0.5 size-6 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        <span>{label}</span>
      </label>
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

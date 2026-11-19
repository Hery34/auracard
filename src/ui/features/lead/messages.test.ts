/**
 * Contract frozen by test-engineer (0032, decisions 1, 3, 5 and 10; criteria 2 and 6): French texts of the contact
 * form and of « Mes messages ». Typographic or straight apostrophes are both accepted.
 *
 * // src/ui/features/lead/messages.ts — decision 14: the error type comes from @/server/actions/lead, never from
 * //   @/server/use-cases/* (no file of src/ui imports a use case, ADR 0012).
 * export const OPEN_LEAD_FORM_LABEL: string;          // « Laisser mes coordonnées » (button that unfolds the form)
 * export const LEAD_SENT_MESSAGE: string;             // role="status" after success, contains « Message envoyé »
 * // Announced by role="alert" next to the form; one message per error of captureLeadAction.
 * export const CAPTURE_LEAD_ERROR_MESSAGES: Readonly<Record<CaptureLeadActionError, string>>;
 * // Announced next to each field (aria-describedby), never the typed value.
 * export const LEAD_FIELD_ERROR_MESSAGES: Readonly<Record<LeadInvalidField, string>>;
 * // GDPR notice under the form (decision 3): purpose (pass the details on to <owner>), recipient (the owner),
 * // retention (12 months), Cloudflare for the anti-robot check, Infomaniak for the e-mail sent to the owner;
 * // decision 14, completed with: « Vous pouvez demander l'accès à vos coordonnées, leur effacement ou vous opposer à
 * // leur traitement auprès de <owner>. Cloudflare peut traiter des données techniques hors de l'Union européenne. »
 * // 0039 point 8: « Base légale : votre consentement, que vous pouvez retirer à tout moment auprès de <owner>. Vous
 * // pouvez introduire une réclamation auprès de la CNIL. »
 * export function leadPrivacyNotice(ownerName: string): string;
 * export function leadConsentLabel(ownerName: string): string;   // label of the mandatory checkbox, « J'accepte … »
 * export const NO_LEADS_MESSAGE: string;              // « Aucun message » …
 * export const OLDER_LEADS_LABEL: string;             // « Messages plus anciens » (decision 10)
 * export const DELETE_LEAD_CONFIRMATION_MESSAGE: string;
 * export const DELETE_LEAD_ERROR_MESSAGES: Readonly<Record<DeleteLeadActionError, string>>;
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { CaptureLeadActionError } from "@/server/actions/lead";
import {
  CAPTURE_LEAD_ERROR_MESSAGES,
  DELETE_LEAD_CONFIRMATION_MESSAGE,
  DELETE_LEAD_ERROR_MESSAGES,
  LEAD_FIELD_ERROR_MESSAGES,
  LEAD_SENT_MESSAGE,
  NO_LEADS_MESSAGE,
  OLDER_LEADS_LABEL,
  OPEN_LEAD_FORM_LABEL,
  leadConsentLabel,
  leadPrivacyNotice,
} from "@/ui/features/lead/messages";

import { legalBasisPattern } from "../../../../tests/builders/privacy";

const GENERIC_ERROR = "Une erreur est survenue, réessayez.";
const OWNER = "Élodie Durand-Mérel";
const UI_DIR = fileURLToPath(new URL("../..", import.meta.url));

/** Decision 14: the sentences added to the notice, apostrophes straight or typographic. */
function rightsSentences(owner: string): RegExp[] {
  const escaped = owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(
      `Vous pouvez demander l['’]accès à vos coordonnées, leur effacement ou vous opposer à leur traitement auprès de ${escaped}\\.`,
    ),
    /Cloudflare peut traiter des données techniques hors de l['’]Union européenne\./,
  ];
}

describe("contact form texts (decisions 1 and 3)", () => {
  it("decision 1: the folded form opens with « Laisser mes coordonnées »", () => {
    expect(OPEN_LEAD_FORM_LABEL).toBe("Laisser mes coordonnées");
  });

  it("criterion 1: success → « Message envoyé »", () => {
    expect(LEAD_SENT_MESSAGE).toMatch(/^Message envoyé/);
  });

  it("decision 3: the notice names the owner, the purpose, 12 months, Cloudflare and Infomaniak", () => {
    const notice = leadPrivacyNotice(OWNER);

    expect(notice).toContain(OWNER);
    expect(notice).toMatch(/transmettre/i);
    expect(notice).toMatch(/12 mois/);
    expect(notice).toMatch(/Cloudflare/);
    expect(notice).toMatch(/anti-robot/i);
    expect(notice).toMatch(/Infomaniak/);
  });

  it("decision 14: the notice states the rights (access, erasure, objection) to the owner and the transfer by Cloudflare", () => {
    const notice = leadPrivacyNotice(OWNER);

    for (const sentence of rightsSentences(OWNER)) {
      expect(notice).toMatch(sentence);
    }
  });

  it("0039 point 8: the notice states the legal basis (consent, withdrawable from the owner) and the complaint to the CNIL", () => {
    expect(leadPrivacyNotice(OWNER)).toMatch(legalBasisPattern(OWNER));
  });

  it("decision 3: the consent label starts with « J'accepte » and names the owner", () => {
    const label = leadConsentLabel(OWNER);

    expect(label).toMatch(/^J['’]accepte/);
    expect(label).toContain(OWNER);
  });
});

describe("captureLeadAction errors (criterion 2)", () => {
  it("decision 14: keyed by CaptureLeadActionError of @/server/actions/lead", () => {
    expectTypeOf(CAPTURE_LEAD_ERROR_MESSAGES).toEqualTypeOf<Readonly<Record<CaptureLeadActionError, string>>>();
  });

  it("decision 14 / ADR 0012: no file of src/ui imports @/server/use-cases", () => {
    const offenders = readdirSync(UI_DIR, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => /from\s+["'](@\/server\/use-cases|[./]+\/server\/use-cases)/.test(readFileSync(path.join(UI_DIR, file), "utf8")));

    expect(offenders).toStrictEqual([]);
  });

  it("covers exactly the errors of captureLeadAction", () => {
    expect(Object.keys(CAPTURE_LEAD_ERROR_MESSAGES).sort()).toStrictEqual([
      "challenge_failed",
      "challenge_unavailable",
      "invalid_input",
      "not_found",
      "rate_limited",
      "unexpected",
    ]);
  });

  it("criterion 2: Turnstile refused → explicit anti-robot message", () => {
    expect(CAPTURE_LEAD_ERROR_MESSAGES.challenge_failed).toMatch(/anti-robot/i);
  });

  it("criterion 2: Cloudflare unavailable → anti-robot check unavailable, try again later; distinct from a refusal", () => {
    expect(CAPTURE_LEAD_ERROR_MESSAGES.challenge_unavailable).toMatch(/anti-robot/i);
    expect(CAPTURE_LEAD_ERROR_MESSAGES.challenge_unavailable).toMatch(/réessayez/i);
    expect(CAPTURE_LEAD_ERROR_MESSAGES.challenge_unavailable).not.toBe(CAPTURE_LEAD_ERROR_MESSAGES.challenge_failed);
  });

  it("criterion 2: limit reached → « Trop de messages »", () => {
    expect(CAPTURE_LEAD_ERROR_MESSAGES.rate_limited).toMatch(/^Trop de messages/);
  });

  it("criterion 3: profile refusing messages → says that messages are not accepted", () => {
    expect(CAPTURE_LEAD_ERROR_MESSAGES.not_found).toMatch(/n['’]accepte pas|ne reçoit pas/i);
  });

  it("invalid_input → « Vérifiez les champs signalés. » (same as the editor)", () => {
    expect(CAPTURE_LEAD_ERROR_MESSAGES.invalid_input).toBe("Vérifiez les champs signalés.");
  });

  it("unexpected → the generic message of the application", () => {
    expect(CAPTURE_LEAD_ERROR_MESSAGES.unexpected).toBe(GENERIC_ERROR);
  });
});

describe("field errors (criterion 6)", () => {
  it("one French message per field, none empty", () => {
    expect(Object.keys(LEAD_FIELD_ERROR_MESSAGES).sort()).toStrictEqual(["consent", "email", "idempotencyKey", "message", "name"]);
    for (const message of Object.values(LEAD_FIELD_ERROR_MESSAGES)) {
      expect(message.trim()).not.toBe("");
    }
  });

  it("e-mail → speaks of the address; consent → speaks of the box to tick; bounds stated", () => {
    expect(LEAD_FIELD_ERROR_MESSAGES.email).toMatch(/adresse e-mail/i);
    expect(LEAD_FIELD_ERROR_MESSAGES.consent).toMatch(/coch/i);
    expect(LEAD_FIELD_ERROR_MESSAGES.name).toMatch(/100/);
    expect(LEAD_FIELD_ERROR_MESSAGES.message).toMatch(/2\s?000/);
  });
});

describe("« Mes messages » texts (decisions 5 and 10)", () => {
  it("empty list and pagination link", () => {
    expect(NO_LEADS_MESSAGE).toMatch(/^Aucun message/);
    expect(OLDER_LEADS_LABEL).toBe("Messages plus anciens");
  });

  it("deletion: confirmation says it is final; errors of deleteLeadAction covered", () => {
    expect(DELETE_LEAD_CONFIRMATION_MESSAGE).toMatch(/définitiv/i);
    expect(Object.keys(DELETE_LEAD_ERROR_MESSAGES).sort()).toStrictEqual(["invalid_input", "not_found", "rate_limited", "unexpected"]);
    expect(DELETE_LEAD_ERROR_MESSAGES.unexpected).toBe(GENERIC_ERROR);
  });
});

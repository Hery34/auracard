function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 0039 point 8 (Hery, 19/11/2026), booking and contact forms: « Base légale : votre consentement, que vous pouvez
 * retirer à tout moment auprès de <propriétaire>. Vous pouvez introduire une réclamation auprès de la CNIL. »
 * Any space (including a non-breaking one) accepted before the colon.
 */
export function legalBasisPattern(ownerName: string): RegExp {
  return new RegExp(
    `Base légale\\s?: votre consentement, que vous pouvez retirer à tout moment auprès de ${escapeRegExp(ownerName)}\\. ` +
      "Vous pouvez introduire une réclamation auprès de la CNIL\\.",
  );
}

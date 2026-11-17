import type { QrColorError } from "@/domain/qr/qr-style";
import type { SaveQrStyleActionError } from "@/server/actions/qr";

const UNEXPECTED = "Une erreur est survenue, réessayez.";

export const PROVISIONAL_DOMAIN_MESSAGE = "Domaine provisoire : n’imprimez pas ce QR code.";
export const STYLE_SAVED_MESSAGE = "Style enregistré.";
export const LOGO_UNAVAILABLE_HINT = "Votre profil n’a pas encore de logo.";

/** Decision 4: the rule broken first, shown live under the colour fields and after a refused save. */
export const QR_COLOR_ERROR_MESSAGES: Readonly<Record<QrColorError, string>> = {
  invalid_color: "Choisissez des couleurs au format #rrggbb.",
  not_darker: "Les modules doivent être plus foncés que le fond.",
  low_contrast: "Contraste insuffisant : 4,5:1 minimum entre les modules et le fond.",
};

/** Announced by `role="alert"`; `unauthenticated` sends to the sign-in page instead. */
export const SAVE_QR_STYLE_ERROR_MESSAGES: Readonly<Record<SaveQrStyleActionError, string>> = {
  ...QR_COLOR_ERROR_MESSAGES,
  invalid_input: UNEXPECTED,
  invalid: "Style refusé, vérifiez les couleurs.",
  no_profile: "Créez d’abord votre profil pour obtenir votre QR code.",
  rate_limited: "Trop de modifications en peu de temps, réessayez dans quelques minutes.",
  unexpected: UNEXPECTED,
};

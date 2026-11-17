import type { QrCodeRepository } from "@/domain/qr/ports";
import { checkQrColors, type QrColorError, type QrStyle } from "@/domain/qr/qr-style";
import type { ProfileReader } from "@/domain/profile/ports";
import type { AuthGateway } from "@/domain/shared/ports/auth-gateway";
import type { RateLimiter } from "@/domain/shared/ports/rate-limiter";
import { err, ok, type Result } from "@/domain/shared/result";
import { authorizeProfileWrite } from "@/server/use-cases/shared/authorize-profile-write";

export type SaveQrStyleError =
  | QrColorError
  | "unauthenticated"
  | "rate_limited"
  | "no_profile"
  | "invalid"
  | "unexpected";

export type SaveQrStyle = (style: QrStyle) => Promise<Result<void, SaveQrStyleError>>;

/**
 * Colour rule of the domain first (nothing called when refused), then session, `profile-write` and own profile, then
 * `set_qr_style`. Replayable: an identical style succeeds again and the database writes nothing.
 */
export function makeSaveQrStyle(deps: {
  auth: AuthGateway;
  rateLimiter: RateLimiter;
  profiles: ProfileReader;
  qrCodes: QrCodeRepository;
}): SaveQrStyle {
  return async ({ fg, bg, logo }) => {
    const refused = checkQrColors(fg, bg);
    if (refused !== null) {
      return err(refused);
    }
    const authorized = await authorizeProfileWrite(deps);
    if (!authorized.ok) {
      return err(authorized.error === "not_found" ? "no_profile" : authorized.error);
    }
    const saved = await deps.qrCodes.setStyle({ fg, bg, logo });
    return saved.ok ? ok(undefined) : err(saved.error);
  };
}

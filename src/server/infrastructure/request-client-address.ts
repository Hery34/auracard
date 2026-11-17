import { clientAddressFrom } from "@/server/infrastructure/client-address";
import { env } from "@/server/infrastructure/env";
import { logWarning } from "@/server/infrastructure/logger";

/** Traefik (EasyPanel) is the only proxy in front of Next.js: it sets the last `x-forwarded-for` element. */
const TRUSTED_PROXY_HOPS = 1;

/** Fixed bucket returned by `clientAddressFrom` in production when the header is absent or invalid. */
const UNKNOWN_ADDRESS = "unknown";

/** Subject of the per-address rate limits of the public surfaces (sign-up, sign-in, vCard). */
export function requestClientAddress(headers: Headers): string {
  const address = clientAddressFrom(headers, {
    trustedProxyHops: TRUSTED_PROXY_HOPS,
    production: env.NODE_ENV === "production",
  });
  if (address === UNKNOWN_ADDRESS) {
    logWarning("client-address", "unknown_address");
  }
  return address;
}

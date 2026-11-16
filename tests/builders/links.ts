import type { Link, SavedLink } from "@/domain/profile/link";

import { aHttpsUrl } from "./https-url";

/** Version 4 UUIDs of links already stored for the profile (ids that `replaceLinks` must forward). */
export const LINK_IDS = [
  "0b6f3a1e-2c4d-4e5f-8a9b-1c2d3e4f5a61",
  "1c7a4b2f-3d5e-4f60-9b0c-2d3e4f5a6b72",
  "2d8b5c30-4e6f-4071-8c1d-3e4f5a6b7c83",
] as const;

/** A link as the editor sends it once validated: no `id` unless given (creation). */
export function aLink(overrides: Partial<Link> = {}): Link {
  return {
    platform: "linkedin",
    url: aHttpsUrl("https://www.linkedin.com/in/elodie-durand-merel"),
    label: null,
    ...overrides,
  };
}

/** A link as stored by `carnet.replace_links`: id and position assigned. */
export function aSavedLink(overrides: Partial<SavedLink> = {}): SavedLink {
  return {
    id: LINK_IDS[0],
    platform: "linkedin",
    url: "https://www.linkedin.com/in/elodie-durand-merel",
    label: null,
    position: 0,
    ...overrides,
  };
}

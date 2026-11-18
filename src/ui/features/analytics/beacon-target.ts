/** What a click on the public page counts as (0029, decision 9): a row of `links`, or a field of the profile. */
export type BeaconTarget = { kind: "link"; linkId: string } | { kind: "contact" };

const LINK_ATTRIBUTE = "data-beacon-link";
const CONTACT_ATTRIBUTE = "data-beacon-contact";

export const CONTACT_TARGET: BeaconTarget = { kind: "contact" };

export function linkTarget(linkId: string): BeaconTarget {
  return { kind: "link", linkId };
}

/** Rendered by server components: the beacon reads clicks from the markup, no handler is shipped per control. */
export function beaconAttributes(target: BeaconTarget): Record<string, string> {
  return target.kind === "link" ? { [LINK_ATTRIBUTE]: target.linkId } : { [CONTACT_ATTRIBUTE]: "" };
}

export function beaconTargetOf(element: Element): BeaconTarget | null {
  const marked = element.closest(`[${LINK_ATTRIBUTE}], [${CONTACT_ATTRIBUTE}]`);
  if (marked === null) {
    return null;
  }
  const linkId = marked.getAttribute(LINK_ATTRIBUTE);
  return linkId === null ? CONTACT_TARGET : linkTarget(linkId);
}

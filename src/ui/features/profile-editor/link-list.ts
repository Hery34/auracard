import { MAX_LINKS, type LinkPlatform, type SavedLink } from "@/domain/profile/link";
import type { EditorLink } from "@/ui/features/profile-editor/editor-state";

const NEW_LINK_PLATFORM: LinkPlatform = "website";

export function canAddLink(links: readonly EditorLink[]): boolean {
  return links.length < MAX_LINKS;
}

/** New empty row at the end; unchanged list at MAX_LINKS. */
export function addLink(links: readonly EditorLink[], key: string): EditorLink[] {
  if (!canAddLink(links)) {
    return [...links];
  }
  return [...links, { key, id: null, platform: NEW_LINK_PLATFORM, url: "", label: "" }];
}

export type LinkPatch = Partial<Pick<EditorLink, "platform" | "url" | "label">>;

export function updateLink(links: readonly EditorLink[], key: string, patch: LinkPatch): EditorLink[] {
  return links.map((link) => (link.key === key ? { ...link, ...patch } : link));
}

export function removeLink(links: readonly EditorLink[], key: string): EditorLink[] {
  return links.filter((link) => link.key !== key);
}

/** Swaps the link with its neighbour (`-1` up, `1` down); unchanged list at either end. */
export function moveLink(links: readonly EditorLink[], key: string, offset: -1 | 1): EditorLink[] {
  const from = links.findIndex((link) => link.key === key);
  const to = from + offset;
  if (from === -1 || to < 0 || to >= links.length) {
    return [...links];
  }
  const moved = [...links];
  [moved[from], moved[to]] = [moved[to] as EditorLink, moved[from] as EditorLink];
  return moved;
}

/**
 * Gives the ids returned by `replaceLinksAction` to the rows that were sent (same order), matched by `key` so that
 * rows edited, moved or removed while the request was running are not mixed up.
 */
export function withSavedIds(
  links: readonly EditorLink[],
  sent: readonly EditorLink[],
  saved: readonly SavedLink[],
): EditorLink[] {
  const ids = new Map(sent.map((link, index) => [link.key, saved[index]?.id ?? link.id]));
  return links.map((link) => ({ ...link, id: ids.get(link.key) ?? link.id }));
}

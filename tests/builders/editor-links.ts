import type { EditorLink } from "@/ui/features/profile-editor/editor-state";

import { LINK_IDS } from "./links";

/** A row of the 0020 editor: stored (`id` set) by default; `id: null` for a row not saved yet. */
export function anEditorLink(overrides: Partial<EditorLink> = {}): EditorLink {
  return {
    key: overrides.id ?? LINK_IDS[0],
    id: LINK_IDS[0],
    platform: "linkedin",
    url: "https://www.linkedin.com/in/elodie-durand-merel",
    label: "",
    ...overrides,
  };
}

/** `count` new rows (keys `new-0`, `new-1`…), as added in the editor. */
export function newEditorLinks(count: number): EditorLink[] {
  return Array.from({ length: count }, (_, index) =>
    anEditorLink({ key: `new-${index}`, id: null, platform: "website", url: `https://site-${index}.example/` }),
  );
}

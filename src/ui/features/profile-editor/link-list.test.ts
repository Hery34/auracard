import { describe, expect, it } from "vitest";

import { MAX_LINKS } from "@/domain/profile/link";
import { addLink, canAddLink, moveLink, removeLink, updateLink, withSavedIds } from "@/ui/features/profile-editor/link-list";

import { anEditorLink, newEditorLinks } from "../../../../tests/builders/editor-links";
import { aSavedLink, LINK_IDS } from "../../../../tests/builders/links";

const keys = (links: ReadonlyArray<{ key: string }>) => links.map((link) => link.key);

describe("addLink / canAddLink", () => {
  it("criterion 2: adds an empty unsaved row at the end", () => {
    const links = addLink([anEditorLink()], "new-row");

    expect(links).toHaveLength(2);
    expect(links[1]).toStrictEqual({ key: "new-row", id: null, platform: "website", url: "", label: "" });
  });

  it("criterion 2: adds up to 12 links, the 13th is impossible", () => {
    let links = newEditorLinks(0);
    for (let index = 0; index < MAX_LINKS; index += 1) {
      expect(canAddLink(links)).toBe(true);
      links = addLink(links, `row-${index}`);
    }

    expect(links).toHaveLength(12);
    expect(canAddLink(links)).toBe(false);
    expect(addLink(links, "row-13")).toStrictEqual(links);
  });
});

describe("updateLink", () => {
  it("criterion 2: patches the row with the given key only, id kept", () => {
    const [first, second] = newEditorLinks(2);
    const links = updateLink([first!, second!], "new-1", { platform: "github", url: "https://github.com/elodie", label: "Code" });

    expect(links[0]).toStrictEqual(first);
    expect(links[1]).toStrictEqual({ ...second, platform: "github", url: "https://github.com/elodie", label: "Code" });
  });
});

describe("removeLink", () => {
  it("criterion 2: removes the row with the given key", () => {
    expect(keys(removeLink(newEditorLinks(3), "new-1"))).toStrictEqual(["new-0", "new-2"]);
  });
});

describe("moveLink", () => {
  it("criterion 2: moves a row up and down", () => {
    const links = newEditorLinks(3);

    expect(keys(moveLink(links, "new-1", -1))).toStrictEqual(["new-1", "new-0", "new-2"]);
    expect(keys(moveLink(links, "new-1", 1))).toStrictEqual(["new-0", "new-2", "new-1"]);
  });

  it("criterion 2: the first row cannot go up, the last cannot go down", () => {
    const links = newEditorLinks(3);

    expect(keys(moveLink(links, "new-0", -1))).toStrictEqual(["new-0", "new-1", "new-2"]);
    expect(keys(moveLink(links, "new-2", 1))).toStrictEqual(["new-0", "new-1", "new-2"]);
  });
});

describe("withSavedIds", () => {
  it("decision 6: gives the returned ids to the rows sent, by key, so that a second save keeps them (no duplicate)", () => {
    const sent = [anEditorLink(), ...newEditorLinks(1)];
    const saved = [aSavedLink({ id: LINK_IDS[0], position: 0 }), aSavedLink({ id: LINK_IDS[1], position: 1 })];

    const links = withSavedIds(sent, sent, saved);

    expect(links.map((link) => link.id)).toStrictEqual([LINK_IDS[0], LINK_IDS[1]]);
    expect(withSavedIds(links, links, saved)).toStrictEqual(links);
  });

  it("decision 6: rows moved, added or removed during the request get the right id or keep theirs", () => {
    const sent = newEditorLinks(2);
    const saved = [aSavedLink({ id: LINK_IDS[1], position: 0 }), aSavedLink({ id: LINK_IDS[2], position: 1 })];
    const current = [sent[1]!, anEditorLink({ key: "late", id: null })];

    expect(withSavedIds(current, sent, saved).map((link) => [link.key, link.id])).toStrictEqual([
      ["new-1", LINK_IDS[2]],
      ["late", null],
    ]);
  });
});

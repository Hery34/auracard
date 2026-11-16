import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Files that define a whole route segment: never client components (`docs/rules/nextjs.md`). */
const SEGMENT_FILES = new Set(["page.tsx", "layout.tsx", "template.tsx"]);

const EXPECTED_ROUTES: ReadonlyArray<{ route: string; group: string }> = [
  { route: "/inscription", group: "(auth)" },
  { route: "/connexion", group: "(auth)" },
  { route: "/verifier-email", group: "(auth)" },
  { route: "/tableau-de-bord", group: "(dashboard)" },
];

type SegmentFile = { file: string; route: string };

function segmentFiles(directory: string): SegmentFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return segmentFiles(file);
    }
    return SEGMENT_FILES.has(entry.name) ? [{ file, route: routeOf(file) }] : [];
  });
}

/** Route served by a segment file: route groups `(name)` removed, root → `/`. */
function routeOf(file: string): string {
  const segments = path
    .relative(APP_DIR, path.dirname(file))
    .split(path.sep)
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

function startsWithUseClient(file: string): boolean {
  return /^\s*(['"])use client\1/.test(readFileSync(file, "utf8"));
}

describe("App Router segments", () => {
  const files = segmentFiles(APP_DIR);

  it.each(EXPECTED_ROUTES)("criterion 6: a page serves $route inside the $group route group", ({ route, group }) => {
    const pages = files.filter((entry) => entry.route === route && path.basename(entry.file) === "page.tsx");

    expect(pages).toHaveLength(1);
    expect(path.relative(APP_DIR, pages[0]?.file ?? "").split(path.sep)).toContain(group);
  });

  it("criterion 6: no page, layout or template is a client component ('use client' belongs to leaf components)", () => {
    const clientSegments = files.filter((entry) => startsWithUseClient(entry.file)).map((entry) => entry.file);

    expect(clientSegments).toStrictEqual([]);
  });
});

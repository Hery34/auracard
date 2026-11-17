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
  { route: "/tableau-de-bord/profil", group: "(dashboard)" },
  { route: "/tableau-de-bord/puces", group: "(dashboard)" },
  { route: "/activer/[uid]", group: "(public)" },
];

/** 0025, decision 3: route handlers (the phase 4 writes the scan event there), never pages. */
const EXPECTED_HANDLERS: ReadonlyArray<{ route: string; group: string }> = [
  { route: "/t/[uid]", group: "(public)" },
  { route: "/q/[code]", group: "(public)" },
];

type SegmentFile = { file: string; route: string };

function handlerFiles(directory: string): SegmentFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return handlerFiles(file);
    }
    return entry.name === "route.ts" ? [{ file, route: routeOf(file) }] : [];
  });
}

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

describe("Route handlers (0025)", () => {
  const handlers = handlerFiles(APP_DIR);
  const pages = segmentFiles(APP_DIR);

  it.each(EXPECTED_HANDLERS)("decision 3: a route handler serves $route inside the $group route group, and no page", ({ route, group }) => {
    const matches = handlers.filter((entry) => entry.route === route);

    expect(matches).toHaveLength(1);
    expect(path.relative(APP_DIR, matches[0]?.file ?? "").split(path.sep)).toContain(group);
    expect(pages.filter((entry) => entry.route === route)).toStrictEqual([]);
  });

  it.each(EXPECTED_HANDLERS)("decision 1: $route exports GET only", ({ route }) => {
    const source = readFileSync(handlers.find((entry) => entry.route === route)?.file ?? "", "utf8");

    expect(source).toMatch(/export\s+(async\s+)?function\s+GET\b/);
    expect(source).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/);
  });
});

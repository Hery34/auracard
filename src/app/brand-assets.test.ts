/**
 * Contract frozen by test-engineer (0014, criterion 3; docs/rules/security.md « Fichiers SVG versionnés »): versioned
 * brand SVGs pass an allowlist (elements, attributes, url(#id) only, restricted CSS) and, except the declared solid
 * variants, have a transparent background. No XML parser dependency: a quote-aware tokenizer is enough because
 * anything it cannot read is refused.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Logo } from "@/ui/primitives/logo";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const EXPECTED = [
  "public/brand/auracard-logo.svg",
  "public/brand/auracard-symbol.svg",
  "public/brand/auracard-symbol-slate.svg",
  "public/brand/auracard-symbol-emerald.svg",
  "src/app/icon.svg",
] as const;

/** Solid variants by design: slate square (apple-icon, manifest) and emerald circle. */
const OPAQUE_BACKGROUND_ALLOWED = new Set(["public/brand/auracard-symbol-slate.svg", "public/brand/auracard-symbol-emerald.svg"]);

const ELEMENTS = new Set([
  "svg", "g", "defs", "mask", "clipPath", "path", "line", "circle", "ellipse", "rect", "polygon", "polyline", "style",
  "title", "desc",
]);

const ATTRIBUTES = new Set([
  "xmlns", "viewBox", "width", "height", "preserveAspectRatio", "id", "class", "style",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform",
  "fill", "fill-rule", "fill-opacity", "opacity", "clip-rule",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
  "stroke-dashoffset", "stroke-opacity",
  "mask", "clip-path", "maskUnits", "maskContentUnits", "clipPathUnits",
]);

const TEXT_ALLOWED_IN = new Set(["title", "desc"]);
const NOT_PAINTED = new Set(["defs", "mask", "clipPath"]);

type Tag = { name: string; closing: boolean; attributes: Map<string, string>; ancestors: string[] };
type Parsed = { tags: Tag[]; styles: string[]; errors: string[] };

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>"']+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parse(source: string): Parsed {
  const errors: string[] = [];
  const tags: Tag[] = [];
  const styles: string[] = [];
  const text = source.replace(/^\uFEFF?\s*/, "").replace(/^<\?xml\s[^?]*\?>/, "");
  if (text.includes("<?")) errors.push("processing instruction <?…?>");
  if (text.includes("<!")) errors.push("markup declaration <!…> (DOCTYPE, ENTITY, CDATA, comment)");
  if (text.includes("&")) errors.push("character or entity reference &");

  const stack: string[] = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("<", index);
    const content = text.slice(index, open === -1 ? text.length : open);
    const parent = stack.at(-1);
    if (parent === "style") styles.push(content);
    else if (content.trim() !== "" && !(parent !== undefined && TEXT_ALLOWED_IN.has(parent))) {
      errors.push(`text in <${parent ?? "document"}>`);
    }
    if (open === -1) break;
    if (text.startsWith("<?", open) || text.startsWith("<!", open)) {
      const end = text.indexOf(">", open);
      if (end === -1) break;
      index = end + 1;
      continue;
    }
    TAG.lastIndex = open;
    const match = TAG.exec(text);
    if (match === null) {
      errors.push(`malformed tag at offset ${open}`);
      break;
    }
    const [, slash, name = "", attributeText = "", selfClosing] = match;
    const closing = slash === "/";
    const attributes = new Map(
      [...attributeText.matchAll(ATTRIBUTE)].map((item) => [item[1] ?? "", item[2] ?? item[3] ?? ""] as const),
    );
    tags.push({ name, closing, attributes, ancestors: [...stack] });
    if (closing) {
      if (stack.pop() !== name) errors.push(`unbalanced </${name}>`);
    } else if (selfClosing !== "/") {
      stack.push(name);
    }
    index = TAG.lastIndex;
  }
  if (stack.length > 0) errors.push(`unclosed <${stack.join("> <")}>`);
  return { tags, styles, errors };
}

function urlViolations(value: string, where: string): string[] {
  const all = value.match(/url\s*\(/gi)?.length ?? 0;
  const internal = value.match(/url\(#[\w-]+\)/g)?.length ?? 0;
  return all === internal ? [] : [`url() other than url(#id) in ${where}`];
}

function cssViolations(css: string, where: string): string[] {
  const found: string[] = [];
  if (css.includes("\\")) found.push(`backslash in ${where}`);
  if (/@(?!media\b)/.test(css)) found.push(`at-rule other than @media in ${where}`);
  if (/["']/.test(css)) found.push(`quote in ${where}`);
  return [...found, ...urlViolations(css, where)];
}

function violations(source: string): string[] {
  const { tags, styles, errors } = parse(source);
  const found = [...errors];
  if (tags[0]?.name !== "svg" || tags[0].closing) found.push("root element is not <svg>");
  for (const tag of tags) {
    if (!ELEMENTS.has(tag.name)) found.push(`element <${tag.name}>`);
    for (const [name, value] of tag.attributes) {
      if (!ATTRIBUTES.has(name)) found.push(`attribute ${name} on <${tag.name}>`);
      if (name === "xmlns" && value !== SVG_NAMESPACE) found.push(`xmlns="${value}" on <${tag.name}>`);
      if (/["']/.test(value)) found.push(`quote inside the value of ${name} on <${tag.name}>`);
      found.push(...urlViolations(value, `${name} on <${tag.name}>`));
      if (name === "style") found.push(...cssViolations(value, `style on <${tag.name}>`));
    }
  }
  for (const css of styles) found.push(...cssViolations(css, "<style>"));
  return found;
}

function viewBox(source: string): [number, number, number, number] | null {
  const root = parse(source).tags.find((tag) => tag.name === "svg");
  const numbers = root?.attributes.get("viewBox")?.trim().split(/[\s,]+/).map(Number) ?? [];
  return numbers.length === 4 && numbers.every(Number.isFinite) ? (numbers as [number, number, number, number]) : null;
}

function length(value: string | undefined, whole: number): number {
  if (value === undefined) return 0;
  const trimmed = value.trim();
  return trimmed.endsWith("%") ? (Number.parseFloat(trimmed) / 100) * whole : Number.parseFloat(trimmed);
}

function isTransparent(fill: string | undefined, opacity: string | undefined): boolean {
  const paint = (fill ?? "black").trim().toLowerCase();
  return paint === "none" || paint === "transparent" || (opacity !== undefined && Number.parseFloat(opacity) === 0);
}

/**
 * Only `<rect>` backgrounds are detected (a full circle or path is not); visual fidelity, including the background,
 * is checked by Hery against the brand charter.
 */
function fullCanvasRects(source: string): Tag[] {
  const box = viewBox(source);
  if (box === null) return [];
  const [minX, minY, width, height] = box;
  return parse(source)
    .tags.filter((tag) => tag.name === "rect" && !tag.closing && !tag.ancestors.some((name) => NOT_PAINTED.has(name)))
    .filter(({ attributes }) => {
      const styleFill = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(attributes.get("style") ?? "")?.[1];
      const opacity = attributes.get("fill-opacity") ?? attributes.get("opacity");
      if (isTransparent(styleFill ?? attributes.get("fill"), opacity)) return false;
      const x = length(attributes.get("x"), width);
      const y = length(attributes.get("y"), height);
      const w = length(attributes.get("width"), width);
      const h = length(attributes.get("height"), height);
      return x <= minX && y <= minY && x + w >= minX + width && y + h >= minY + height;
    });
}

function svgFilesUnder(directory: string, recursive: boolean): string[] {
  const absolute = join(ROOT, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive })
    .map(String)
    .filter((name) => name.toLowerCase().endsWith(".svg"))
    .map((name) => `${directory}/${name.split("\\").join("/")}`);
}

function controlledFiles(): string[] {
  return [...new Set([...EXPECTED, ...svgFilesUnder("public/brand", false), ...svgFilesUnder("src/app", true)])].sort();
}

function read(file: string): string {
  return existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf8") : "";
}

const svg = (body: string, prolog = "") => `${prolog}<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 10 10">${body}</svg>`;

/** Bypasses raised by the security audit of 0014: each one must be refused, for the stated reason. */
const BYPASSES: [string, string, RegExp][] = [
  ["élément préfixé <x:script>", svg('<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>'), /element <x:script>/],
  ["« > » dans une valeur ne ferme pas la balise", svg('<a title=">" onclick="alert(1)"><path d="M0 0"/></a>'), /attribute onclick on <a>/],
  ["instruction <?xml-stylesheet?>", svg('<path d="M0 0"/>', '<?xml-stylesheet href="https://evil.example/x.css"?>'), /processing instruction/],
  ["<animate> réécrivant href", svg('<animate attributeName="href" values="javascript:alert(1)"/>'), /element <animate>/],
  ["<set>", svg('<set attributeName="fill" to="red"/>'), /element <set>/],
  ["échappement CSS \\75 rl(", svg("<style>path{fill:\\75 rl(https://evil.example/x)}</style>"), /backslash in <style>/],
  ["échappement CSS @\\69mport", svg('<style>@\\69mport "https://evil.example/x.css";</style>'), /backslash in <style>/],
  ["référence de caractère &#117;rl(", svg('<path style="fill:&#117;rl(https://evil.example/x)" d="M0 0"/>'), /reference &/],
  ["attribut src", svg('<path src="https://evil.example/x" d="M0 0"/>'), /attribute src on <path>/],
  ["attribut xml:base", svg('<g xml:base="https://evil.example/"><path d="M0 0"/></g>'), /attribute xml:base on <g>/],
  ["<iframe> XHTML", svg('<iframe xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example/"/>'), /element <iframe>/],
  ["<img> XHTML", svg('<img xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example/x.png"/>'), /element <img>/],
  ["<script>", svg("<script>alert(1)</script>"), /element <script>/],
  ["<foreignObject>", svg("<foreignObject><p>x</p></foreignObject>"), /element <foreignObject>/],
  ["<image> externe", svg('<image href="https://evil.example/x.png"/>'), /element <image>/],
  ["href externe", svg('<path href="https://evil.example/" d="M0 0"/>'), /attribute href on <path>/],
  ["xlink:href externe", svg('<path xlink:href="https://evil.example/" d="M0 0"/>'), /attribute xlink:href on <path>/],
  ["gestionnaire onload", svg('<g onload="alert(1)"/>'), /attribute onload on <g>/],
  ["DOCTYPE et ENTITY", svg('<path d="M0 0"/>', '<!DOCTYPE svg [<!ENTITY e "x">]>'), /markup declaration/],
  ["url() externe en attribut", svg('<path fill="url(https://evil.example/#p)" d="M0 0"/>'), /url\(\) other than url\(#id\) in fill/],
  ["url() externe dans <style>", svg("<style>path{fill:url(https://evil.example/#p)}</style>"), /url\(\) other than url\(#id\) in <style>/],
  ["@import dans <style>", svg('<style>@import "https://evil.example/x.css";</style>'), /at-rule other than @media/],
  ["chaîne externe image-set(\"…\") dans <style>", svg('<style>path{fill:image-set("https://x" 1x)}</style>'), /quote in <style>/],
  ["chaîne externe image-set('…') en attribut", svg('<path mask="image-set(\'https://x\' 1x)" d="M0 0"/>'), /quote inside the value of mask on <path>/],
  ["xmlns XHTML sur la racine", '<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 10 10"/>', /xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/],
  ["valeur d'attribut sans guillemets", svg("<path d=M0 onclick=alert(1)/>"), /malformed tag/],
];

describe("brand SVG assets (0014)", () => {
  it.each(EXPECTED)("critère 3 : %s est versionné", (file) => {
    expect(existsSync(join(ROOT, file)), `${file} existe`).toBe(true);
  });

  describe.each(controlledFiles())("%s", (file) => {
    it("critère 3 : racine <svg> avec un viewBox", () => {
      expect(read(file).trimStart()).toMatch(/^(?:<\?xml\s[^?]*\?>\s*)?<svg\b/);
      expect(viewBox(read(file)), `viewBox de ${file}`).not.toBeNull();
    });

    it("critère 3 : liste blanche respectée (éléments, attributs, url(#id), CSS sans échappement ni @ hors @media, ni <? ni & ni <!)", () => {
      expect(existsSync(join(ROOT, file)), `${file} existe`).toBe(true);
      expect(violations(read(file))).toStrictEqual([]);
    });

    it("critère 3 : les découpes #111111 des sources sont remplacées (aucune couleur #111111)", () => {
      expect(existsSync(join(ROOT, file)), `${file} existe`).toBe(true);
      expect(read(file)).not.toMatch(/#111(?:111)?\b/i);
    });

    if (!OPAQUE_BACKGROUND_ALLOWED.has(file)) {
      it("critère 3 : fond transparent, aucun <rect> opaque couvrant tout le viewBox", () => {
        expect(existsSync(join(ROOT, file)), `${file} existe`).toBe(true);
        expect(fullCanvasRects(read(file))).toStrictEqual([]);
      });
    }
  });

  it.each(BYPASSES)("critère 3 : contournement refusé, %s", (_label, source, reason) => {
    expect(violations(source).join("\n")).toMatch(reason);
  });

  it("la liste blanche accepte un SVG minimal conforme (mask, url(#id), @media)", () => {
    const source = svg(
      '<style>@media (prefers-color-scheme: light){path{fill:#000}}</style><defs><mask id="m"><rect width="10" height="10" fill="#fff"/></mask></defs><path d="M0 0" mask="url(#m)"/>',
      '<?xml version="1.0" encoding="UTF-8"?>\n',
    );
    expect(violations(source)).toStrictEqual([]);
  });

  it("le détecteur de fond reconnaît le fond opaque des sources fournies par Hery", () => {
    expect(fullCanvasRects(readFileSync(join(ROOT, "docs/assets/auracard-logo.svg"), "utf8"))).toHaveLength(1);
    expect(fullCanvasRects(readFileSync(join(ROOT, "docs/assets/eslint.config.svg"), "utf8"))).toHaveLength(1);
    expect(fullCanvasRects(svg('<mask id="m"><rect width="100%" height="100%" fill="white"/></mask>'))).toHaveLength(0);
  });

  it("cohérence : polygone et tracés « AURA » / « CARD » identiques dans logo.tsx et public/brand/auracard-logo.svg", () => {
    const shapes = (source: string) => {
      const opening = parse(source).tags.filter((tag) => !tag.closing);
      return {
        points: opening.filter((tag) => tag.name === "polygon").map((tag) => tag.attributes.get("points")),
        paths: opening.filter((tag) => tag.name === "path").map((tag) => tag.attributes.get("d")).sort(),
      };
    };
    const component = shapes(renderToStaticMarkup(createElement(Logo)));
    const file = shapes(read("public/brand/auracard-logo.svg"));

    expect(component.points).toHaveLength(1);
    expect(component.paths).toHaveLength(3);
    expect(component).toStrictEqual(file);
  });
});

// Regenerates the 0014 brand assets from docs/assets/auracard-logo.svg. Run from the repository root:
//   node scripts/brand-assets.mjs
// Needs @playwright/test (Chromium) from the repository and ImageMagick (`magick`) for the ICO.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = ROOT;
const { chromium } = createRequire(ROOT + "package.json")("@playwright/test");
const src = readFileSync(ROOT + "docs/assets/auracard-logo.svg", "utf8");
const round = (d) => d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n) * 10) / 10));
const texts = [...src.matchAll(/<path d="([^"]*)" fill="([^"]*)"\/>/g)].map((m) => round(m[1]));
if (texts.length !== 2) {
  throw new Error(`docs/assets/auracard-logo.svg: expected 2 text paths, found ${texts.length}`);
}
const WHITE = "#FCFCFD", EMERALD = "#00C896", SLATE = "#1E2022", INK = "#0A0A0C";

function symbol(p, { white = WHITE, green = EMERALD, greenOpacity, whiteClass = false } = {}) {
  const cls = whiteClass ? ' class="w"' : "";
  const box = 'maskUnits="userSpaceOnUse" x="0" y="0" width="680" height="440"';
  const bg = '<rect width="680" height="440" fill="#fff"/>';
  const hole = '<circle cx="461" cy="218" r="135" fill="#000"/>';
  const g = greenOpacity ? `<g opacity="${greenOpacity}">` : "<g>";
  return `<defs>
<mask id="${p}c-mask" ${box}>${bg}<g stroke="#000" stroke-width="78"><line x1="250" y1="238" x2="350" y2="338"/><line x1="152" y1="308" x2="330" y2="130"/></g>${hole}</mask>
<mask id="${p}low-band-mask" ${box}>${bg}<line x1="152" y1="308" x2="330" y2="130" stroke="#000" stroke-width="78"/>${hole}</mask>
<mask id="${p}high-band-mask" ${box}>${bg}${hole}</mask>
</defs>
<g fill="none" stroke-width="62">
<path${cls} d="M317.2 87.2A166 166 0 1 0 317.2 348.8" stroke="${white}" mask="url(#${p}c-mask)"/>
${g}<line x1="250" y1="238" x2="350" y2="338" stroke="${green}" mask="url(#${p}low-band-mask)"/>
<circle cx="461" cy="218" r="166" stroke="${green}"/>
<line x1="152" y1="308" x2="350" y2="110" stroke="${green}" mask="url(#${p}high-band-mask)"/></g>
</g>
<polygon${cls} points="400,306 551,155 506,110 451,165 406,120 361,165 406,210 355,261" fill="${white}"/>`;
}
const svg = (vb, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">\n${body}\n</svg>\n`;
const LOGO_VB = "45 59 1677 316";
const files = {
  "public/brand/auracard-symbol.svg": svg("16 20 644 396", symbol("")),
  "public/brand/auracard-logo.svg": svg(LOGO_VB, `<g transform="translate(40 51) scale(.76)">\n${symbol("")}\n</g>\n<path d="${texts[0]}" fill="${WHITE}"/>\n<path d="${texts[1]}" fill="${EMERALD}"/>`),
  "public/brand/auracard-symbol-slate.svg": svg("0 0 512 512", `<rect width="512" height="512" rx="112" fill="${SLATE}"/>\n<g transform="translate(53.5 125.2) scale(.6)">\n${symbol("")}\n</g>`),
  "public/brand/auracard-symbol-emerald.svg": svg("0 0 512 512", `<circle cx="256" cy="256" r="256" fill="${EMERALD}"/>\n<g transform="translate(70.4 136.1) scale(.55)">\n${symbol("", { green: WHITE, greenOpacity: ".6" })}\n</g>`),
  "src/app/icon.svg": svg("16 -104 644 644", `<style>@media (prefers-color-scheme: light){path.w{stroke:${INK}}polygon.w{fill:${INK}}}</style>\n${symbol("", { whiteClass: true })}`),
};
for (const [f, c] of Object.entries(files)) { writeFileSync(OUT + f, c); }
// Raster icons: platforms apply their own corner mask, so home-screen icons are full-bleed slate squares.
const fullBleedSlate = files["public/brand/auracard-symbol-slate.svg"].replace(' rx="112"', "");
const tmp = mkdtempSync(join(tmpdir(), "brand-"));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  async function shot(out, width, height, svgSource, background = "transparent") {
    await page.setViewportSize({ width, height });
    const src = "data:image/svg+xml;base64," + Buffer.from(svgSource).toString("base64");
    await page.setContent(`<body style="margin:0;background:${background};display:grid;place-items:center;width:${width}px;height:${height}px">` +
      `<img style="width:${background === "transparent" ? width : 840}px" src="${src}"></body>`);
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({ path: out, omitBackground: background === "transparent" });
  }
  await shot(OUT + "src/app/apple-icon.png", 180, 180, fullBleedSlate);
  await shot(OUT + "public/brand/icon-192.png", 192, 192, fullBleedSlate);
  await shot(OUT + "public/brand/icon-512.png", 512, 512, fullBleedSlate);
  await shot(OUT + "src/app/opengraph-image.png", 1200, 630, files["public/brand/auracard-logo.svg"], INK);
  const ico = [];
  for (const size of [16, 32, 48]) {
    ico.push(join(tmp, `favicon-${size}.png`));
    await shot(ico.at(-1), size, size, files["public/brand/auracard-symbol-slate.svg"]);
  }
  execFileSync("magick", [...ico, OUT + "src/app/favicon.ico"]);
} finally {
  await browser?.close();
  rmSync(tmp, { recursive: true, force: true });
}

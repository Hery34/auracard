import { expect, test, type Locator, type Page } from "@playwright/test";

import { DELETED_LINK_ID, OTHER_DELETED_LINK_ID } from "../builders/stats";
import { workerAddress } from "./helpers/accounts";
import { linkIdAt } from "./helpers/analytics";
import { colorsOf, contrastRatio, cssRgb, relativeLuminance } from "./helpers/contrast";
import { signIn } from "./helpers/nfc";
import { createProfile, type LinkFixture, type ProfileFixture } from "./helpers/public-profile";
import { parisDaysAgo, seedDailyAggregates } from "./helpers/stats";

/**
 * Contrat de balisage de la fiche 0030, figé par ces tests :
 *
 * `/tableau-de-bord` : lien nommé exactement « Mes statistiques » (`href="/tableau-de-bord/statistiques"`).
 * `/tableau-de-bord/statistiques` (sans session → `/connexion`), page dynamique, `Cache-Control` contenant `no-store` :
 * - titre `h1` « Mes statistiques » ;
 * - quatre commandes de période dans `<main>` (lien, bouton ou onglet) nommées exactement « 7 jours », « 30 jours »,
 *   « 12 semaines », « 12 mois » ; 30 jours par défaut ; la période active porte `aria-current` (`page` ou `true`),
 *   `aria-pressed="true"` ou `aria-selected="true"` ;
 * - sans aucune donnée sur la période : un message commençant par « Aucune donnée » dans `<main>` ;
 * - avec données : six cartes de totaux, chacune un élément de rôle `group` (ou `region`) dont le nom accessible est le
 *   libellé, et dont le texte ne contient qu'un seul nombre, la valeur : « Scans NFC », « Scans QR », « Vues » (ou
 *   « Vues du profil »), un libellé contenant « vCard », « Clics sur les liens »,
 *   « Clics contact (téléphone, e-mail, site web) » ;
 * - décision 1 : chaque graphique a un tableau de données équivalent (`<table>`, éventuellement masqué visuellement,
 *   nom accessible par `<caption>` ou `aria-label`) :
 *   - série : nom contenant « par jour », « par semaine » ou « par mois » (seul tableau de la page à porter ce nom),
 *     une ligne de données par intervalle (7, 30, 12, 12), jours sans donnée compris ; décision 8 : tableau **visible**
 *     (pas `sr-only`), éventuellement replié dans un `<details>` dont le `<summary>` le déplie ; en-têtes de colonne :
 *     l'intervalle puis les six métriques dans l'ordre de `STATS_METRICS`, mêmes libellés que les cartes ; chaque ligne :
 *     libellé de l'intervalle puis les six valeurs ;
 *   - décision 8 : libellés visibles, hors tableau, du premier et du dernier intervalle sous les barres (jour
 *     « 18 nov. », mois « novembre 2026 ») ;
 *   - répartition des vues : nom contenant « par source », lignes « NFC », « QR », « Direct », valeur en dernière cellule ;
 * - tableau des clics : nom contenant « par lien », une ligne par lien actuel (libellé actuel, ou nom de la plateforme
 *   sans libellé), puis une seule ligne « Lien supprimé » pour tous les `link_id` inconnus ; valeur en dernière cellule ;
 * - mention exacte : « Mis à jour toutes les 15 minutes. Robots et aperçus de liens exclus. » ;
 * - thème AuraCard sombre, textes ≥ 4,5:1.
 * Les agrégats sont écrits par le client `service_role` des tests, à des jours éloignés des bornes de période.
 */

test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const STATS_PATH = "/tableau-de-bord/statistiques";
const NOTICE = "Mis à jour toutes les 15 minutes. Robots et aperçus de liens exclus.";
const EMPTY = /^\s*Aucune donnée/;
const DELETED = /Lien supprimé/;
const TEXT_MIN = 4.5;

const CARDS = {
  nfc: /^Scans NFC$/,
  qr: /^Scans QR$/,
  views: /^Vues( du profil)?$/,
  vcard: /vCard/,
  links: /^Clics sur les liens$/,
  contact: /^Clics contact \(téléphone, e-mail, site web\)$/,
} as const;

const PERIODS = { "7d": "7 jours", "30d": "30 jours", "12w": "12 semaines", "12m": "12 mois" } as const;

const LINKS: readonly LinkFixture[] = [
  { platform: "instagram", url: "https://www.instagram.com/elodie.dm/", label: "Mes photos" },
  { platform: "linkedin", url: "https://www.linkedin.com/in/elodie-durand-merel", label: null },
];

function main(page: Page): Locator {
  return page.getByRole("main");
}

function card(page: Page, name: RegExp): Locator {
  return main(page).getByRole("group", { name }).or(main(page).getByRole("region", { name }));
}

function periodControl(page: Page, name: string): Locator {
  const options = { name, exact: true } as const;
  return main(page)
    .getByRole("link", options)
    .or(main(page).getByRole("button", options))
    .or(main(page).getByRole("tab", options));
}

function table(page: Page, name: RegExp): Locator {
  return main(page).getByRole("table", { name });
}

function dataRows(page: Page, tableLocator: Locator): Locator {
  return tableLocator.getByRole("row").filter({ has: page.getByRole("cell") });
}

/** The single integer shown in a locator's text (thousands separators of fr-FR tolerated). */
async function integerIn(locator: Locator): Promise<number> {
  const text = (await locator.innerText()).replace(/[\s  ]+(?=\d)/g, "");
  const numbers = text.match(/\d+/g) ?? [];
  expect(numbers, `un seul nombre dans « ${text} »`).toHaveLength(1);
  return Number(numbers[0]);
}

async function totalOf(page: Page, name: RegExp): Promise<number> {
  return integerIn(card(page, name));
}

async function lastCellOf(row: Locator): Promise<number> {
  return integerIn(row.getByRole("cell").last());
}

async function isActive(control: Locator): Promise<boolean> {
  const [current, pressed, selected] = await Promise.all([
    control.getAttribute("aria-current"),
    control.getAttribute("aria-pressed"),
    control.getAttribute("aria-selected"),
  ]);
  return current === "page" || current === "true" || pressed === "true" || selected === "true";
}

async function expectAuraCardContrast(target: Locator, label: string): Promise<void> {
  const { text, background } = await colorsOf(target);
  expect(relativeLuminance(text), `${label} : texte ${cssRgb(text)} plus clair que le fond ${cssRgb(background)}`).toBeGreaterThan(
    relativeLuminance(background),
  );
  const ratio = contrastRatio(text, background);
  expect(ratio, `${label} : ${cssRgb(text)} sur ${cssRgb(background)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_MIN);
}

/**
 * Published profile with two links and known aggregates. Expected:
 * - 7 jours : vues 10 (NFC 3, QR 2, direct 5), NFC 3, QR 2, vCard 1, liens 6 (Mes photos 4, LinkedIn 0, supprimé 2), contact 3 ;
 * - 30 jours : vues 20, NFC 7, liens 9 (supprimé 5, deux link_id inconnus) ; 12 semaines : vues 50 ; 12 mois : vues 150.
 */
async function profileWithStats(): Promise<ProfileFixture> {
  const profile = await createProfile({}, LINKS);
  const instagramId = await linkIdAt(profile.profileId, 0);
  const recent = parisDaysAgo(2);
  const lastMonth = parisDaysAgo(20);
  await seedDailyAggregates(profile.profileId, [
    { day: recent, metric: "profile_view", linkId: null, source: "nfc", value: 3 },
    { day: recent, metric: "profile_view", linkId: null, source: "qr", value: 2 },
    { day: recent, metric: "profile_view", linkId: null, source: "direct", value: 5 },
    { day: recent, metric: "nfc_scan", linkId: null, source: "nfc", value: 3 },
    { day: recent, metric: "qr_scan", linkId: null, source: "qr", value: 2 },
    { day: recent, metric: "vcard_download", linkId: null, source: "direct", value: 1 },
    { day: recent, metric: "link_click", linkId: instagramId, source: "direct", value: 4 },
    { day: recent, metric: "link_click", linkId: DELETED_LINK_ID, source: "direct", value: 2 },
    { day: recent, metric: "contact_click", linkId: null, source: "direct", value: 2 },
    { day: recent, metric: "contact_click", linkId: null, source: "nfc", value: 1 },
    { day: lastMonth, metric: "profile_view", linkId: null, source: "direct", value: 10 },
    { day: lastMonth, metric: "nfc_scan", linkId: null, source: "nfc", value: 4 },
    { day: lastMonth, metric: "link_click", linkId: OTHER_DELETED_LINK_ID, source: "nfc", value: 3 },
    { day: parisDaysAgo(60), metric: "profile_view", linkId: null, source: "direct", value: 30 },
    { day: parisDaysAgo(200), metric: "profile_view", linkId: null, source: "direct", value: 100 },
  ]);
  return profile;
}

async function openStats(page: Page, email: string): Promise<void> {
  await signIn(page, email);
  await page.goto(STATS_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Mes statistiques" })).toBeVisible();
}

async function choosePeriod(page: Page, name: string): Promise<void> {
  await periodControl(page, name).click();
  await expect.poll(() => isActive(periodControl(page, name))).toBe(true);
}

const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" });
const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "long", year: "numeric" });

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function dayLabel(day: string): string {
  return DAY_LABEL.format(utcDate(day));
}

function monthLabel(day: string, monthsAgo: number): string {
  const date = utcDate(day);
  return MONTH_LABEL.format(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthsAgo, 1)));
}

const SERIES = /par (jour|semaine|mois)/i;

/** The series table, unfolded when it sits in a closed `<details>` (mobile), then really visible (not `sr-only`). */
async function revealSeriesTable(page: Page): Promise<Locator> {
  const series = table(page, SERIES);
  const disclosure = main(page).locator("details").filter({ has: series });
  if ((await disclosure.count()) > 0 && (await disclosure.first().getAttribute("open")) === null) {
    await disclosure.first().locator("summary").first().click();
  }
  await expect(series).toBeVisible();
  const firstCell = dataRows(page, series).first().locator("th, td").first();
  await firstCell.scrollIntoViewIfNeeded();
  const hitTestable = await firstCell.evaluate((cell) => {
    const box = cell.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && cell.contains(hit);
  });
  expect(hitTestable, "tableau de la série réellement visible (ni sr-only, ni masqué)").toBe(true);
  return series;
}

async function cellTexts(row: Locator): Promise<string[]> {
  return (await row.locator("th, td").allInnerTexts()).map((text) => text.replace(/[\s  ]+/g, " ").trim());
}

/** A visible label outside any table (under the bars). */
function boundLabel(page: Page, label: string): Locator {
  return main(page).getByText(label, { exact: true }).and(page.locator(":not(table *)"));
}

test.describe("Mes statistiques : accès (critères 2 et 4, décision 4)", () => {
  test("lien « Mes statistiques » depuis le tableau de bord", async ({ page }) => {
    const profile = await createProfile();
    await signIn(page, profile.email);

    const link = page.getByRole("link", { name: "Mes statistiques", exact: true });
    await expect(link).toHaveAttribute("href", STATS_PATH);
    await link.click();

    await expect(page).toHaveURL(new RegExp(`${STATS_PATH}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Mes statistiques" })).toBeVisible();
  });

  test("sans session → /connexion", async ({ page }) => {
    await page.goto(STATS_PATH);

    await expect(page).toHaveURL(/\/connexion/);
  });

  test("décision 4 : page dynamique, Cache-Control no-store", async ({ page }) => {
    const profile = await createProfile();
    await signIn(page, profile.email);

    const response = await page.goto(STATS_PATH);

    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"] ?? "").toMatch(/no-store/);
  });

  test("critère 2 : un autre propriétaire ne voit jamais les chiffres de ce profil", async ({ page }) => {
    await profileWithStats();
    const other = await createProfile();

    await openStats(page, other.email);

    await expect(main(page).getByText(EMPTY).first()).toBeVisible();
    await expect(main(page).getByText(DELETED)).toHaveCount(0);
  });
});

test.describe("Mes statistiques : état vide (critère 3)", () => {
  test("critère 3 : sans aucune donnée → état vide explicite", async ({ page }) => {
    const profile = await createProfile({}, LINKS);

    await openStats(page, profile.email);

    await expect(main(page).getByText(EMPTY).first()).toBeVisible();
    await expect(main(page).getByText(DELETED)).toHaveCount(0);
  });
});

test.describe("Mes statistiques : chiffres (critère 1, décisions 1 à 3, 5 et 6)", () => {
  test("critère 1 : 30 jours par défaut ; cartes de totaux ; mention de mise à jour", async ({ page }) => {
    const profile = await profileWithStats();

    await openStats(page, profile.email);

    expect(await isActive(periodControl(page, PERIODS["30d"]))).toBe(true);
    expect(await totalOf(page, CARDS.views)).toBe(20);
    expect(await totalOf(page, CARDS.nfc)).toBe(7);
    expect(await totalOf(page, CARDS.qr)).toBe(2);
    expect(await totalOf(page, CARDS.vcard)).toBe(1);
    expect(await totalOf(page, CARDS.links)).toBe(9);
    expect(await totalOf(page, CARDS.contact)).toBe(3);
    await expect(main(page).getByText(NOTICE, { exact: true })).toBeVisible();
    await expect(main(page).getByText(EMPTY)).toHaveCount(0);
  });

  test("critère 1 : changement de période → totaux et séries de la période (7 j, 12 semaines, 12 mois)", async ({ page }) => {
    const profile = await profileWithStats();
    await openStats(page, profile.email);

    await choosePeriod(page, PERIODS["7d"]);
    await expect.poll(() => totalOf(page, CARDS.views)).toBe(10);
    expect(await totalOf(page, CARDS.nfc)).toBe(3);
    expect(await totalOf(page, CARDS.links)).toBe(6);
    expect(await isActive(periodControl(page, PERIODS["30d"]))).toBe(false);

    await choosePeriod(page, PERIODS["12w"]);
    await expect.poll(() => totalOf(page, CARDS.views)).toBe(50);

    await choosePeriod(page, PERIODS["12m"]);
    await expect.poll(() => totalOf(page, CARDS.views)).toBe(150);
  });

  test("décisions 1 et 2 : un tableau équivalent par graphique, un intervalle par ligne, jours sans donnée compris", async ({ page }) => {
    const profile = await profileWithStats();
    await openStats(page, profile.email);

    await expect(dataRows(page, table(page, /par jour/i))).toHaveCount(30);

    await choosePeriod(page, PERIODS["7d"]);
    await expect(dataRows(page, table(page, /par jour/i))).toHaveCount(7);

    await choosePeriod(page, PERIODS["12w"]);
    await expect(dataRows(page, table(page, /par semaine/i))).toHaveCount(12);

    await choosePeriod(page, PERIODS["12m"]);
    await expect(dataRows(page, table(page, /par mois/i))).toHaveCount(12);
  });

  test("décision 3 : répartition des vues par source (NFC, QR, direct)", async ({ page }) => {
    const profile = await profileWithStats();
    await openStats(page, profile.email);
    await choosePeriod(page, PERIODS["7d"]);

    const sources = table(page, /par source/i);
    await expect.poll(() => lastCellOf(sources.getByRole("row", { name: /\bNFC\b/ }))).toBe(3);
    expect(await lastCellOf(sources.getByRole("row", { name: /\bQR\b/ }))).toBe(2);
    expect(await lastCellOf(sources.getByRole("row", { name: /direct/i }))).toBe(5);
  });

  test("décision 3 : clics par lien, libellé actuel, une seule ligne « Lien supprimé » pour tous les liens supprimés", async ({ page }) => {
    const profile = await profileWithStats();
    await openStats(page, profile.email);

    const links = table(page, /par lien/i);
    await expect(links.getByRole("row", { name: DELETED })).toHaveCount(1);
    expect(await lastCellOf(links.getByRole("row", { name: DELETED }))).toBe(5);
    expect(await lastCellOf(links.getByRole("row", { name: /Mes photos/ }))).toBe(4);
    expect(await lastCellOf(links.getByRole("row", { name: /LinkedIn/ }))).toBe(0);

    await choosePeriod(page, PERIODS["7d"]);
    await expect.poll(() => lastCellOf(links.getByRole("row", { name: DELETED }))).toBe(2);
    await expect(links.getByRole("row", { name: DELETED })).toHaveCount(1);
  });

  test("critère 4 : thème AuraCard, titre, mention, cartes, commandes de période et tableau ≥ 4,5:1", async ({ page }) => {
    const profile = await profileWithStats();
    await openStats(page, profile.email);

    await expectAuraCardContrast(page.getByRole("heading", { level: 1 }), "titre");
    await expectAuraCardContrast(main(page).getByText(NOTICE, { exact: true }), "mention");
    for (const [key, name] of Object.entries(CARDS)) {
      await expectAuraCardContrast(card(page, name), `carte ${key}`);
    }
    for (const name of Object.values(PERIODS)) {
      await expectAuraCardContrast(periodControl(page, name), `période ${name}`);
    }
    await expectAuraCardContrast(table(page, /par lien/i).getByRole("row", { name: DELETED }).getByRole("cell").last(), "cellule");
  });
});

test.describe("Mes statistiques : tableau de la série (décision 8)", () => {
  test("décision 8 : tableau de la série visible, six colonnes de métriques dans l'ordre, bons chiffres par jour", async ({ page }) => {
    const profile = await profileWithStats();
    await openStats(page, profile.email);
    await choosePeriod(page, PERIODS["7d"]);

    const series = await revealSeriesTable(page);
    await expect(main(page).getByRole("table", { name: SERIES })).toHaveCount(1);

    const headers = (await series.getByRole("columnheader").allInnerTexts()).map((text) => text.trim());
    expect(headers, "l'intervalle puis six métriques").toHaveLength(7);
    const metrics = [CARDS.nfc, CARDS.qr, CARDS.views, CARDS.vcard, CARDS.links, CARDS.contact];
    metrics.forEach((name, index) => expect(headers[index + 1], `colonne ${index + 1}`).toMatch(name));

    const rows = dataRows(page, series);
    await expect(rows).toHaveCount(7);
    expect(await cellTexts(rows.nth(4))).toStrictEqual([dayLabel(parisDaysAgo(2)), "3", "2", "10", "1", "6", "3"]);
    expect(await cellTexts(rows.nth(0))).toStrictEqual([dayLabel(parisDaysAgo(6)), "0", "0", "0", "0", "0", "0"]);
    expect(await cellTexts(rows.nth(6))).toStrictEqual([dayLabel(parisDaysAgo(0)), "0", "0", "0", "0", "0", "0"]);
  });

  test("décision 8 : 12 mois → une ligne par mois avec les six métriques", async ({ page }) => {
    const profile = await profileWithStats();
    await openStats(page, profile.email);
    await choosePeriod(page, PERIODS["12m"]);

    const series = await revealSeriesTable(page);
    const rows = dataRows(page, series);
    await expect(rows).toHaveCount(12);
    for (let index = 0; index < 12; index += 1) {
      const cells = await cellTexts(rows.nth(index));
      expect(cells, `ligne ${index}`).toHaveLength(7);
      expect(cells[0]).toBe(monthLabel(parisDaysAgo(0), 11 - index));
    }
  });

  test("décision 8 : libellés du premier et du dernier intervalle visibles sous les barres (7 jours, 12 mois)", async ({ page }) => {
    const profile = await profileWithStats();
    await openStats(page, profile.email);

    await choosePeriod(page, PERIODS["7d"]);
    await expect(boundLabel(page, dayLabel(parisDaysAgo(6))).first()).toBeVisible();
    await expect(boundLabel(page, dayLabel(parisDaysAgo(0))).first()).toBeVisible();

    await choosePeriod(page, PERIODS["12m"]);
    await expect(boundLabel(page, monthLabel(parisDaysAgo(0), 11)).first()).toBeVisible();
    await expect(boundLabel(page, monthLabel(parisDaysAgo(0), 0)).first()).toBeVisible();
  });
});

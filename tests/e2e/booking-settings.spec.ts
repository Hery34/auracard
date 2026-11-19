import { expect, test, type Locator, type Page } from "@playwright/test";

import { workerAddress } from "./helpers/accounts";
import {
  localInDays,
  seedTypeWithBooking,
  storedEventTypes,
  storedExceptions,
  storedRules,
  storedTimeZone,
} from "./helpers/booking-settings";
import { colorsOf, contrastRatio, cssRgb } from "./helpers/contrast";
import { signIn } from "./helpers/nfc";
import { createProfile, type ProfileFixture } from "./helpers/public-profile";

/**
 * Contrat de balisage de la fiche 0038, figé par ces tests (profils iPhone 15 et Pixel 7).
 *
 * `/tableau-de-bord` : lien nommé exactement « Réglages des rendez-vous » (`href="/tableau-de-bord/rendez-vous/reglages"`).
 *
 * `/tableau-de-bord/rendez-vous/reglages` (sans session → `/connexion`), dynamique (`Cache-Control` contenant `no-store`) :
 * - titre `h1` « Réglages des rendez-vous » ;
 * - décision 2 : dans `<main>`, le rappel exact « En phase 1, votre agenda (Google, Outlook) n'est pas lu : tenez vos
 *   disponibilités à jour. » (apostrophe droite ou typographique) ;
 * - quatre sections de rôle `region` (`<section aria-labelledby>`), nommées par leur `h2` : « Fuseau horaire »,
 *   « Types de rendez-vous », « Disponibilités hebdomadaires », « Absences et ouvertures ponctuelles » ;
 * - « Fuseau horaire » : `<select>` étiqueté « Fuseau horaire » (une option par fuseau de
 *   `Intl.supportedValuesOf('timeZone')`, `value` = nom IANA), sélection = fuseau enregistré (défaut `Europe/Paris`) ;
 *   bouton « Enregistrer le fuseau » ;
 * - « Types de rendez-vous » : formulaire d'ajout aux champs étiquetés « Titre », « Durée (minutes) »,
 *   « Tampon après le rendez-vous (minutes) » (défaut 0), « Délai minimal de réservation (minutes) » (défaut 120),
 *   `<select>` « Lieu » (options « En personne », « Téléphone », « Visio »), « Adresse ou lien de visio » ; bouton
 *   « Ajouter le type ». Chaque type = un `listitem` de la section contenant son titre et sa durée (« 30 min »), et
 *   « Désactivé » s'il l'est ; boutons dont le nom commence par « Modifier », « Désactiver » / « Réactiver »,
 *   « Monter », « Descendre », « Supprimer » (une confirmation `dialog` / `alertdialog` éventuelle se valide par un
 *   bouton dont le nom commence par « Supprimer ») ;
 * - « Disponibilités hebdomadaires » : un groupe (`fieldset` + `legend`, rôle `group`) par jour, « Lundi » à
 *   « Dimanche » ; dans chaque groupe un bouton « Ajouter une plage » ; une plage = deux `<input type="time">`
 *   étiquetés « Début » et « Fin » et un bouton « Retirer la plage » ; bouton « Enregistrer les disponibilités » ;
 * - « Absences et ouvertures ponctuelles » : `<select>` « Nature » (« Absence », « Ouverture ponctuelle »), deux
 *   `<input type="datetime-local">` « Début » et « Fin » (heure du fuseau du profil), bouton « Ajouter » ; chaque
 *   exception à venir = un `listitem` de la section contenant « Absence » ou « Ouverture ponctuelle » et un bouton
 *   « Supprimer » ;
 * - après chaque enregistrement réussi : `role="status"` dans `<main>` ; après un refus : `role="alert"` dans `<main>`
 *   contenant le message ; chaque champ fautif `aria-invalid="true"` et `aria-describedby` vers un élément contenant
 *   son message (jamais la valeur saisie) ;
 * - mobile : aucune barre de défilement horizontal ; boutons ≥ 44 px de haut ; textes et boutons ≥ 4,5:1.
 * - 0038 point 6 (idempotence) : le formulaire « Ajouter le type » et le formulaire « Ajouter » des exceptions portent
 *   chacun un champ caché `name="id"` (UUID minuscule) présent dès le HTML servi, tiré par le Server Component (jamais
 *   dans le navigateur, jamais dans le réducteur) ; deux envois du même formulaire (même `id`) ne créent qu'un
 *   enregistrement ; après un enregistrement réussi, la page revalidée fournit un nouvel `id`.
 */

test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const SETTINGS_PATH = "/tableau-de-bord/rendez-vous/reglages";
const NOTICE = /En phase 1, votre agenda \(Google, Outlook\) n['’]est pas lu : tenez vos disponibilités à jour\./;
const CHECK_FIELDS = "Vérifiez les champs signalés.";
const MIN_TARGET_PX = 44;
const TEXT_MIN = 4.5;
const SECTIONS = {
  timeZone: "Fuseau horaire",
  types: "Types de rendez-vous",
  week: "Disponibilités hebdomadaires",
  exceptions: "Absences et ouvertures ponctuelles",
} as const;

function main(page: Page): Locator {
  return page.getByRole("main");
}

function section(page: Page, name: string): Locator {
  return main(page).getByRole("region", { name, exact: true });
}

function day(page: Page, name: string): Locator {
  return section(page, SECTIONS.week).getByRole("group", { name, exact: true });
}

/** `role="alert"` of the page content: the Next.js route announcer (same role, outside `<main>`) is left out. */
function formAlert(page: Page): Locator {
  return main(page).getByRole("alert");
}

function status(page: Page): Locator {
  return main(page).getByRole("status");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The `<form>` of a section that contains the given submit button. */
function formWith(page: Page, sectionName: string, button: string): Locator {
  return section(page, sectionName)
    .locator("form")
    .filter({ has: page.getByRole("button", { name: button, exact: true }) });
}

function hiddenId(form: Locator): Locator {
  return form.locator('input[type="hidden"][name="id"]');
}

/** Values of the hidden `id` inputs of the HTML served for the page (Server Component output, before any script). */
async function servedHiddenIds(page: Page): Promise<string[]> {
  const html = await (await page.request.get(SETTINGS_PATH)).text();
  return (html.match(/<input\b[^>]*>/g) ?? [])
    .filter((tag) => /\btype="hidden"/.test(tag) && /\bname="id"/.test(tag))
    .map((tag) => /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "");
}

/** Counts the Server Action POSTs (header `next-action`) answered for this page. */
function countActionResponses(page: Page): () => number {
  let count = 0;
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "POST" && request.headers()["next-action"] !== undefined) {
      count += 1;
    }
  });
  return () => count;
}

/** Two submissions of the same form in the same task: the second one is sent before React re-renders. */
async function submitTwice(form: Locator): Promise<void> {
  await form.evaluate((element) => {
    const target = element as HTMLFormElement;
    target.requestSubmit();
    target.requestSubmit();
  });
}

async function openSettings(page: Page, profile: ProfileFixture): Promise<void> {
  await signIn(page, profile.email);
  await page.goto(SETTINGS_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Réglages des rendez-vous" })).toBeVisible();
}

async function addType(page: Page, fields: { title: string; duration: string; kind: string; place: string }): Promise<void> {
  const types = section(page, SECTIONS.types);
  await types.getByLabel("Titre", { exact: true }).fill(fields.title);
  await types.getByLabel("Durée (minutes)", { exact: true }).fill(fields.duration);
  await types.getByLabel("Lieu", { exact: true }).selectOption({ label: fields.kind });
  await types.getByLabel("Adresse ou lien de visio", { exact: true }).fill(fields.place);
  await types.getByRole("button", { name: "Ajouter le type", exact: true }).click();
}

async function addPlage(page: Page, dayName: string, start: string, end: string): Promise<void> {
  const group = day(page, dayName);
  await group.getByRole("button", { name: "Ajouter une plage", exact: true }).click();
  await group.getByLabel("Début", { exact: true }).last().fill(start);
  await group.getByLabel("Fin", { exact: true }).last().fill(end);
}

async function expectAnnouncedFieldError(page: Page, field: Locator): Promise<void> {
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await field.getAttribute("aria-describedby")) ?? "";
  expect(describedBy, "aria-describedby vers le message du champ").not.toBe("");
  const texts = await Promise.all(
    describedBy.split(/\s+/).map((id) => page.locator(`[id="${id}"]`).innerText().catch(() => "")),
  );
  expect(texts.join(" ").trim(), "message du champ").not.toBe("");
}

async function expectContrast(target: Locator, label: string): Promise<void> {
  const { text, background } = await colorsOf(target);
  const ratio = contrastRatio(text, background);
  expect(ratio, `${label} : ${cssRgb(text)} sur ${cssRgb(background)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_MIN);
}

test.describe("réglages des rendez-vous (0038)", () => {
  test("accessible depuis le tableau de bord ; sans session → /connexion ; jamais en cache", async ({ page }) => {
    const anonymous = await page.request.get(SETTINGS_PATH, { maxRedirects: 0 });
    expect([303, 307, 308]).toContain(anonymous.status());
    expect(anonymous.headers()["location"] ?? "").toMatch(/\/connexion/);

    const profile = await createProfile({});
    await signIn(page, profile.email);
    const link = main(page).getByRole("link", { name: "Réglages des rendez-vous", exact: true });
    await expect(link).toHaveAttribute("href", SETTINGS_PATH);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${SETTINGS_PATH}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Réglages des rendez-vous" })).toBeVisible();

    const response = await page.request.get(SETTINGS_PATH);
    expect(response.headers()["cache-control"] ?? "").toContain("no-store");
  });

  test("décision 2 : le rappel de phase 1 est visible ; les quatre sections sont nommées", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);

    await expect(main(page).getByText(NOTICE)).toBeVisible();
    for (const name of Object.values(SECTIONS)) {
      await expect(section(page, name)).toBeVisible();
    }
  });

  test("critère 1 : création d'un type, relue après rechargement et en base", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);
    const types = section(page, SECTIONS.types);

    await expect(types.getByLabel("Délai minimal de réservation (minutes)", { exact: true })).toHaveValue("120");
    await expect(types.getByLabel("Tampon après le rendez-vous (minutes)", { exact: true })).toHaveValue("0");
    await addType(page, { title: "Appel découverte", duration: "30", kind: "Visio", place: "https://visio.example.test/elodie" });

    await expect(status(page)).toBeVisible();
    const item = types.getByRole("listitem").filter({ hasText: "Appel découverte" });
    await expect(item).toContainText("30 min");

    await page.reload();
    await expect(section(page, SECTIONS.types).getByRole("listitem").filter({ hasText: "Appel découverte" })).toContainText("30 min");
    expect(
      (await storedEventTypes(profile.profileId)).map(({ title, duration_min, buffer_min, min_notice_min, location_kind, location_text, is_active, position }) => ({
        title,
        duration_min,
        buffer_min,
        min_notice_min,
        location_kind,
        location_text,
        is_active,
        position,
      })),
    ).toStrictEqual([
      {
        title: "Appel découverte",
        duration_min: 30,
        buffer_min: 0,
        min_notice_min: 120,
        location_kind: "video",
        location_text: "https://visio.example.test/elodie",
        is_active: true,
        position: 0,
      },
    ]);
  });

  test("critère 1 : désactivation d'un type (« Désactivé » affiché, relu après rechargement)", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);
    await addType(page, { title: "Atelier", duration: "60", kind: "En personne", place: "12 rue des Lilas, 69003 Lyon" });
    const item = () => section(page, SECTIONS.types).getByRole("listitem").filter({ hasText: "Atelier" });
    await expect(item()).toBeVisible();

    await item().getByRole("button", { name: /^Désactiver/ }).click();
    await expect(item()).toContainText("Désactivé");

    await page.reload();
    await expect(item()).toContainText("Désactivé");
    await expect(item().getByRole("button", { name: /^Réactiver/ })).toBeVisible();
    expect((await storedEventTypes(profile.profileId)).map(({ is_active }) => is_active)).toStrictEqual([false]);
  });

  test("note de 0036 : supprimer un type qui a des réservations → message « désactivez-le », type conservé", async ({ page }) => {
    const profile = await createProfile({});
    await seedTypeWithBooking(profile.profileId, "Type réservé");
    await openSettings(page, profile);
    const item = section(page, SECTIONS.types).getByRole("listitem").filter({ hasText: "Type réservé" });

    await item.getByRole("button", { name: /^Supprimer/ }).click();
    const confirmation = page.getByRole("dialog").or(page.getByRole("alertdialog"));
    if (await confirmation.isVisible()) {
      await confirmation.getByRole("button", { name: /^Supprimer/ }).click();
    }

    await expect(formAlert(page)).toContainText(/désactivez-le/i);
    await page.reload();
    await expect(section(page, SECTIONS.types).getByRole("listitem").filter({ hasText: "Type réservé" })).toBeVisible();
    expect(await storedEventTypes(profile.profileId)).toHaveLength(1);
  });

  test("critère 1 : saisie d'une semaine type, relue après rechargement et en base", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);

    await addPlage(page, "Lundi", "09:00", "12:00");
    await addPlage(page, "Lundi", "14:00", "18:00");
    await addPlage(page, "Mardi", "09:30", "12:30");
    await section(page, SECTIONS.week).getByRole("button", { name: "Enregistrer les disponibilités", exact: true }).click();
    await expect(status(page)).toBeVisible();

    await page.reload();
    const monday = day(page, "Lundi");
    await expect(monday.getByLabel("Début", { exact: true })).toHaveCount(2);
    await expect(monday.getByLabel("Début", { exact: true }).nth(0)).toHaveValue("09:00");
    await expect(monday.getByLabel("Fin", { exact: true }).nth(0)).toHaveValue("12:00");
    await expect(monday.getByLabel("Début", { exact: true }).nth(1)).toHaveValue("14:00");
    await expect(monday.getByLabel("Fin", { exact: true }).nth(1)).toHaveValue("18:00");
    await expect(day(page, "Mardi").getByLabel("Début", { exact: true })).toHaveValue("09:30");
    await expect(day(page, "Mercredi").getByLabel("Début", { exact: true })).toHaveCount(0);
    expect(await storedRules(profile.profileId)).toStrictEqual([
      { weekday: 1, start_time: "09:00:00", end_time: "12:00:00" },
      { weekday: 1, start_time: "14:00:00", end_time: "18:00:00" },
      { weekday: 2, start_time: "09:30:00", end_time: "12:30:00" },
    ]);
  });

  test("critère 3 : plage incohérente → erreur annoncée (alert, champ aria-invalid décrit), rien enregistré", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);

    await addPlage(page, "Jeudi", "10:00", "09:00");
    await section(page, SECTIONS.week).getByRole("button", { name: "Enregistrer les disponibilités", exact: true }).click();

    await expect(formAlert(page)).toBeVisible();
    const thursday = day(page, "Jeudi");
    const end = thursday.getByLabel("Fin", { exact: true });
    const start = thursday.getByLabel("Début", { exact: true });
    const flagged = (await end.getAttribute("aria-invalid")) === "true" ? end : start;
    await expectAnnouncedFieldError(page, flagged);
    expect(await storedRules(profile.profileId)).toStrictEqual([]);
  });

  test("critère 1 : ajout d'une absence, relue après rechargement et stockée à l'heure de Paris", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);
    const now = new Date();
    const start = localInDays(now, 20, "09:00");
    const end = localInDays(now, 22, "18:00");
    const exceptions = section(page, SECTIONS.exceptions);

    await exceptions.getByLabel("Nature", { exact: true }).selectOption({ label: "Absence" });
    await exceptions.getByLabel("Début", { exact: true }).fill(start);
    await exceptions.getByLabel("Fin", { exact: true }).fill(end);
    await exceptions.getByRole("button", { name: "Ajouter", exact: true }).click();

    await expect(status(page)).toBeVisible();
    await expect(exceptions.getByRole("listitem").filter({ hasText: "Absence" })).toHaveCount(1);
    await page.reload();
    await expect(section(page, SECTIONS.exceptions).getByRole("listitem").filter({ hasText: "Absence" })).toHaveCount(1);
    const toInstant = (local: string) =>
      new Date(Temporal.PlainDateTime.from(local).toZonedDateTime("Europe/Paris").epochMilliseconds).toISOString();
    expect((await storedExceptions(profile.profileId)).map(({ kind, startsAt, endsAt }) => ({ kind, startsAt, endsAt }))).toStrictEqual([
      { kind: "busy", startsAt: toInstant(start), endsAt: toInstant(end) },
    ]);
  });

  test("critère 3 : un titre blanc est refusé et annoncé (« Vérifiez les champs signalés. », Titre aria-invalid)", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);

    await addType(page, { title: "   ", duration: "30", kind: "Visio", place: "https://visio.example.test/elodie" });

    await expect(formAlert(page)).toContainText(CHECK_FIELDS);
    await expectAnnouncedFieldError(page, section(page, SECTIONS.types).getByLabel("Titre", { exact: true }));
    expect(await storedEventTypes(profile.profileId)).toStrictEqual([]);
  });

  test("0038 point 6 : les formulaires de création portent un id fourni par la page (HTML servi), renouvelé après un succès", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);
    const typeForm = formWith(page, SECTIONS.types, "Ajouter le type");
    const exceptionForm = formWith(page, SECTIONS.exceptions, "Ajouter");

    await expect(hiddenId(typeForm)).toHaveCount(1);
    await expect(hiddenId(exceptionForm)).toHaveCount(1);
    const typeId = await hiddenId(typeForm).inputValue();
    const exceptionId = await hiddenId(exceptionForm).inputValue();
    expect(typeId).toMatch(UUID);
    expect(exceptionId).toMatch(UUID);
    expect(typeId).not.toBe(exceptionId);

    const served = await servedHiddenIds(page);
    expect(served, "deux champs id cachés dans le HTML servi (profil sans type ni exception)").toHaveLength(2);
    for (const id of served) {
      expect(id).toMatch(UUID);
    }

    await addType(page, { title: "Appel découverte", duration: "30", kind: "Visio", place: "https://visio.example.test/elodie" });
    await expect(status(page)).toBeVisible();
    await expect(section(page, SECTIONS.types).getByRole("listitem").filter({ hasText: "Appel découverte" })).toBeVisible();
    await expect(hiddenId(typeForm)).not.toHaveValue(typeId);
    expect(await hiddenId(typeForm).inputValue()).toMatch(UUID);
    expect((await storedEventTypes(profile.profileId)).map(({ id }) => id)).toStrictEqual([typeId]);
  });

  test("0038 point 6 : double soumission de la création d'un type (même id) → un seul type", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);
    const answered = countActionResponses(page);
    const types = section(page, SECTIONS.types);
    await types.getByLabel("Titre", { exact: true }).fill("Appel découverte");
    await types.getByLabel("Durée (minutes)", { exact: true }).fill("30");
    await types.getByLabel("Lieu", { exact: true }).selectOption({ label: "Visio" });
    await types.getByLabel("Adresse ou lien de visio", { exact: true }).fill("https://visio.example.test/elodie");

    await submitTwice(formWith(page, SECTIONS.types, "Ajouter le type"));

    await expect.poll(answered, { message: "les deux envois ont reçu une réponse" }).toBeGreaterThanOrEqual(2);
    await expect(status(page)).toBeVisible();
    expect(await storedEventTypes(profile.profileId)).toHaveLength(1);
    await page.reload();
    await expect(section(page, SECTIONS.types).getByRole("listitem").filter({ hasText: "Appel découverte" })).toHaveCount(1);
  });

  test("0038 point 6 : double soumission de l'ajout d'une exception (même id) → une seule exception", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);
    const answered = countActionResponses(page);
    const now = new Date();
    const exceptions = section(page, SECTIONS.exceptions);
    await exceptions.getByLabel("Nature", { exact: true }).selectOption({ label: "Absence" });
    await exceptions.getByLabel("Début", { exact: true }).fill(localInDays(now, 20, "09:00"));
    await exceptions.getByLabel("Fin", { exact: true }).fill(localInDays(now, 22, "18:00"));

    await submitTwice(formWith(page, SECTIONS.exceptions, "Ajouter"));

    await expect.poll(answered, { message: "les deux envois ont reçu une réponse" }).toBeGreaterThanOrEqual(2);
    await expect(status(page)).toBeVisible();
    expect(await storedExceptions(profile.profileId)).toHaveLength(1);
    await page.reload();
    await expect(section(page, SECTIONS.exceptions).getByRole("listitem").filter({ hasText: "Absence" })).toHaveCount(1);
  });

  test("ADR 0016 §2 : choix du fuseau, relu après rechargement", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);
    const select = section(page, SECTIONS.timeZone).getByLabel("Fuseau horaire", { exact: true });
    await expect(select).toHaveValue("Europe/Paris");

    await select.selectOption("America/New_York");
    await section(page, SECTIONS.timeZone).getByRole("button", { name: "Enregistrer le fuseau", exact: true }).click();
    await expect(status(page)).toBeVisible();

    await page.reload();
    await expect(section(page, SECTIONS.timeZone).getByLabel("Fuseau horaire", { exact: true })).toHaveValue("America/New_York");
    expect(await storedTimeZone(profile.profileId)).toBe("America/New_York");
  });

  test("critère 3 : mobile (aucun défilement horizontal, cibles ≥ 44 px) et contrastes AA", async ({ page }) => {
    const profile = await createProfile({});
    await openSettings(page, profile);
    await addPlage(page, "Lundi", "09:00", "12:00");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "défilement horizontal").toBeLessThanOrEqual(0);

    const buttons = main(page).getByRole("button");
    for (const button of await buttons.all()) {
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      expect(box?.height ?? 0, `hauteur de « ${(await button.innerText()).trim()} »`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    }

    await expectContrast(page.getByRole("heading", { level: 1 }), "titre");
    await expectContrast(main(page).getByText(NOTICE), "rappel de phase 1");
    for (const name of Object.values(SECTIONS)) {
      await expectContrast(section(page, name).getByRole("heading", { level: 2 }), `titre de section ${name}`);
    }
    await expectContrast(section(page, SECTIONS.types).getByText("Titre", { exact: true }), "étiquette Titre");
    await expectContrast(section(page, SECTIONS.types).getByRole("button", { name: "Ajouter le type", exact: true }), "bouton Ajouter le type");
    await expectContrast(
      section(page, SECTIONS.week).getByRole("button", { name: "Enregistrer les disponibilités", exact: true }),
      "bouton Enregistrer les disponibilités",
    );
    await expectContrast(day(page, "Lundi").getByRole("button", { name: "Retirer la plage", exact: true }), "bouton Retirer la plage");
  });
});

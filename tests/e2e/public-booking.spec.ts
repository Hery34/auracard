import { readFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { legalBasisPattern } from "../builders/privacy";
import { profileEvents } from "./helpers/analytics";
import { colorsOf, contrastRatio, cssRgb } from "./helpers/contrast";
import { refusingOrigin } from "./helpers/leads";
import { freshAddress, signIn } from "./helpers/nfc";
import {
  bookingStart,
  dayLabel,
  icsUtc,
  localInstant,
  seedEventTypes,
  seedRules,
  setProfileTimeZone,
  storedBookings,
  takeSlotBehindTheApplication,
  timeLabel,
  upcomingTimeChange,
  type RuleFixture,
  type TypeFixture,
} from "./helpers/public-booking";
import { FULL_PROFILE, createProfile, type ProfileFixture } from "./helpers/public-profile";
/**
 * Contrat de balisage de la fiche 0039, figé par ces tests (profils iPhone 15 et Pixel 7). Clés Turnstile de test et
 * serveur « refus » (port 3001) : comme `lead.spec.ts` (0032, décision 6 ; `playwright.config.ts`).
 *
 * Page publique `/p/{slug}` :
 * - au moins un type actif : un lien nommé exactement « Prendre rendez-vous », `href="/p/{slug}/rdv"` ;
 * - aucun type actif (aucun type, ou seulement des types désactivés) : aucun lien de ce nom ; le lien suit les
 *   modifications du propriétaire (création ou désactivation d'un type dans les réglages de 0038 : la page publique
 *   en cache est invalidée).
 *
 * `/p/{slug}/rdv` (profil publié avec au moins un type actif ; sinon réponse 404) :
 * - titre `h1` contenant le nom affiché du propriétaire ;
 * - décision 4 : à l'ouverture, un événement `booking_viewed` (beacon de 0029) ; au choix d'un créneau, un
 *   événement `booking_started` ;
 * - un groupe (`fieldset` + `legend`, rôle `group`, ou `radiogroup`) nommé « Type de rendez-vous » : un bouton radio
 *   par type actif (même s'il n'y en a qu'un), dont le nom commence par son titre ; aucun type désactivé ;
 * - un groupe « Jour » : un bouton radio par jour ayant au moins un créneau dans la semaine affichée, nommé par
 *   `Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" })` dans le fuseau du
 *   navigateur (ex. « lundi 23 novembre ») ; boutons « Semaine suivante » et « Semaine précédente » ; la première
 *   semaine affichée commence aujourd'hui (jour local du navigateur) ;
 * - un groupe « Créneau » : un bouton radio par créneau du jour choisi, dont le nom commence par l'heure de début
 *   « HH:MM » (24 h) dans le fuseau du navigateur ; chaque choix est un `<label>` visible (contenant le bouton radio
 *   ou lié par `for`) ; sélection au clavier (focus, Espace, flèches) ; un créneau qui afficherait deux fois la même
 *   heure (passage à l'heure d'hiver) est complété par son décalage UTC ;
 * - décision 2 : le texte « Horaires affichés dans votre fuseau horaire » suivi de l'identifiant IANA du navigateur ;
 *   si le fuseau du propriétaire diffère, un texte contenant « fuseau horaire de <nom du propriétaire> » et
 *   l'identifiant IANA du propriétaire ; absent sinon ;
 * - formulaire de coordonnées : champs étiquetés « Nom », « E-mail » (`type="email"`), un champ dont l'étiquette
 *   commence par « Téléphone » (`type="tel"`, obligatoire — `required` — pour un type `phone`), un champ dont
 *   l'étiquette commence par « Message » (facultatif) ; case à cocher obligatoire nommée « J'accepte … <nom> » ;
 *   mention d'information (décision 3 : nom du propriétaire, « 12 mois après » le rendez-vous, droits, Cloudflare,
 *   Infomaniak) ; champ caché `idempotencyKey` (uuid v4, jamais dans le HTML servi) ; widget Turnstile rendu avec
 *   `action: "booking"` et `cData: <slug>` ; bouton « Confirmer le rendez-vous » ;
 * - succès (décision 5) : `role="status"` contenant « Rendez-vous confirmé », un récapitulatif (titre du type, jour et
 *   heure dans le fuseau du navigateur), un lien « Ajouter à mon agenda » qui télécharge un fichier `.ics`, et le
 *   rappel que l'e-mail de confirmation contient le lien d'annulation ;
 * - refus : `role="alert"` dans `<main>` ; créneau pris entre l'affichage et l'envoi → message contenant « déjà pris »
 *   ou « n'est plus disponible », la liste des créneaux est relue (le créneau pris n'y figure plus, le type et le jour
 *   choisis restent sélectionnés, les coordonnées saisies sont conservées) ; Turnstile refusé
 *   → « anti-robot » ; champs invalides → « Vérifiez les champs signalés. », chaque champ fautif `aria-invalid="true"`
 *   et `aria-describedby` vers son message ; après tout refus sans écriture, nouvelle clé d'idempotence ;
 * - mobile : aucun défilement horizontal ; choix de créneau ≥ 44 px de haut ; textes et bouton ≥ 4,5:1 ;
 * - le lien de visio d'un type `video` n'apparaît jamais sur la page (0036 point 14), aucun `href` en `javascript:`.
 *
 * Fuseaux : le navigateur est émulé (`timezoneId`) ; les créneaux et jours attendus sont calculés par `Intl` dans ce
 * fuseau. L'horloge est celle du serveur (la base compare avec son now()) : chaque créneau est choisi à J+3 ou plus.
 * Cas DST : exécuté seulement si un changement d'heure tombe dans l'horizon de 60 jours à la date du test
 * (`upcomingTimeChange`), sinon ignoré avec sa raison ; le DST est couvert sans condition par les tests unitaires
 * (`slot-days.test.ts`, `slots.test.ts`) et pgTAP (0036).
 */

const BOOK_LINK = "Prendre rendez-vous";
const GROUPS = { type: "Type de rendez-vous", day: "Jour", slot: "Créneau" } as const;
const SUBMIT = "Confirmer le rendez-vous";
const NEXT_WEEK = "Semaine suivante";
const CONFIRMED = /Rendez-vous confirmé/;
const ADD_TO_CALENDAR = "Ajouter à mon agenda";
const SLOT_TAKEN = /déjà (été )?pris|n['’]est plus disponible/i;
const ANTI_ROBOT = /anti-robot/i;
const CHECK_FIELDS = "Vérifiez les champs signalés.";
const CONSENT = /^J['’]accepte/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_TIMEOUT = { timeout: 30_000 } as const;
const MIN_TARGET_PX = 44;
const TEXT_MIN = 4.5;
const BROWSER_ZONE = "Europe/Paris";

const VISITOR = { name: "Jean Visiteur E2E", email: "jean.visiteur@example.test", phone: "+33 6 12 34 56 78" } as const;

const VIDEO: TypeFixture = { title: "Appel découverte", duration_min: 30, location_kind: "video", location_text: "https://visio.example.test/secret-e2e" };
const PHONE: TypeFixture = { title: "Rappel téléphonique", duration_min: 30, location_kind: "phone", location_text: null };
const VISIT: TypeFixture = { title: "Visite de l'atelier", duration_min: 60, location_kind: "in_person", location_text: "12 rue des Lilas, 69003 Lyon" };

/** Every day 09:00–12:00 and 14:00–18:00 in the owner's zone. */
const EVERY_DAY: readonly RuleFixture[] = [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
  { weekday, start_time: "09:00", end_time: "12:00" },
  { weekday, start_time: "14:00", end_time: "18:00" },
]);

test.use({ timezoneId: BROWSER_ZONE });

// ---------------------------------------------------------------------------------------------------------------
// Fixtures, locators and actions

type Bookable = ProfileFixture & { typeIds: string[] };

async function bookableProfile(types: readonly TypeFixture[] = [VIDEO], options: { timeZone?: string; rules?: readonly RuleFixture[] } = {}): Promise<Bookable> {
  const profile = await createProfile();
  if (options.timeZone !== undefined) {
    await setProfileTimeZone(profile.profileId, options.timeZone);
  }
  const typeIds = await seedEventTypes(profile.profileId, types);
  await seedRules(profile.profileId, options.rules ?? EVERY_DAY);
  return { ...profile, typeIds };
}

function main(page: Page): Locator {
  return page.getByRole("main");
}

function group(page: Page, name: string): Locator {
  return main(page).getByRole("group", { name, exact: true }).or(main(page).getByRole("radiogroup", { name, exact: true }));
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function typeRadio(page: Page, title: string): Locator {
  return group(page, GROUPS.type).getByRole("radio", { name: new RegExp(`^${escape(title)}`) });
}

function dayRadio(page: Page, label: string): Locator {
  return group(page, GROUPS.day).getByRole("radio", { name: new RegExp(escape(label), "i") });
}

function slotRadio(page: Page, time: string): Locator {
  return group(page, GROUPS.slot).getByRole("radio", { name: new RegExp(`^${escape(time)}`) });
}

function bookingForm(page: Page): Locator {
  return main(page).locator("form").filter({ has: page.getByRole("button", { name: SUBMIT, exact: true }) });
}

function field(page: Page, label: string | RegExp): Locator {
  return bookingForm(page).getByLabel(label, typeof label === "string" ? { exact: true } : {});
}

function consent(page: Page): Locator {
  return bookingForm(page).getByRole("checkbox", { name: CONSENT });
}

function formAlert(page: Page): Locator {
  return main(page).getByRole("alert");
}

async function openBookingPage(page: Page, slug: string, origin = ""): Promise<void> {
  await freshAddress(page);
  const response = await page.goto(`${origin}/p/${slug}/rdv`);
  expect(response?.status(), `/p/${slug}/rdv`).toBe(200);
}

/** Keyboard selection of a radio: focus, then Space. */
async function pick(page: Page, radio: Locator): Promise<void> {
  await radio.focus();
  await page.keyboard.press("Space");
  await expect(radio).toBeChecked();
}

/** Owner's `time` on the day `daysAhead` after today (owner's zone), as the browser shows it. */
function target(daysAhead: number, time: string, ownerZone = BROWSER_ZONE, browserZone = BROWSER_ZONE) {
  const date = Temporal.Now.plainDateISO(ownerZone).add({ days: daysAhead });
  const start = localInstant(date, time, ownerZone);
  return { start, day: dayLabel(start, browserZone), time: timeLabel(start, browserZone) };
}

/** Moves forward week by week until the day is offered (at most nine weeks: the 60-day horizon). */
async function showDay(page: Page, label: string): Promise<void> {
  for (let week = 0; week < 9 && (await dayRadio(page, label).count()) === 0; week += 1) {
    await main(page).getByRole("button", { name: NEXT_WEEK, exact: true }).click();
    await page.waitForTimeout(300);
  }
  await expect(dayRadio(page, label)).toHaveCount(1);
}

async function chooseSlot(page: Page, typeTitle: string, choice: { day: string; time: string }): Promise<void> {
  await pick(page, typeRadio(page, typeTitle));
  await showDay(page, choice.day);
  await pick(page, dayRadio(page, choice.day));
  await pick(page, slotRadio(page, choice.time));
}

async function fillVisitor(page: Page, options: { phone?: boolean } = {}): Promise<void> {
  await field(page, "Nom").fill(VISITOR.name);
  await field(page, "E-mail").fill(VISITOR.email);
  if (options.phone === true) {
    await field(page, /^Téléphone/).fill(VISITOR.phone);
  }
  await consent(page).check();
}

async function waitForChallengeToken(page: Page): Promise<void> {
  await expect(bookingForm(page).locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, TOKEN_TIMEOUT);
}

async function submit(page: Page): Promise<void> {
  await bookingForm(page).getByRole("button", { name: SUBMIT, exact: true }).click();
}

async function idempotencyKeyOf(page: Page): Promise<string> {
  const key = await bookingForm(page).locator('input[type="hidden"][name="idempotencyKey"]').inputValue();
  expect(key).toMatch(UUID_V4);
  return key;
}

async function expectContrast(target: Locator, label: string): Promise<void> {
  const { text, background } = await colorsOf(target);
  const ratio = contrastRatio(text, background);
  expect(ratio, `${label} : ${cssRgb(text)} sur ${cssRgb(background)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_MIN);
}

async function expectAnnouncedFieldError(page: Page, control: Locator, pattern: RegExp): Promise<void> {
  await expect(control).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await control.getAttribute("aria-describedby")) ?? "";
  expect(describedBy, "aria-describedby").not.toBe("");
  const description = (await Promise.all(describedBy.split(/\s+/).map((id) => page.locator(`[id="${id}"]`).innerText()))).join(" ");
  expect(description).toMatch(pattern);
}

type TurnstileRender = { action: unknown; cData: unknown };
const TURNSTILE_SCRIPT = /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/(b\/[^/]+\/)?api\.js/;

/** Same wrapper as lead.spec.ts: records the options of every `window.turnstile.render`. */
async function watchTurnstileRenders(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __turnstileRenders: TurnstileRender[] }).__turnstileRenders = [];
  });
  await page.route(TURNSTILE_SCRIPT, async (route) => {
    const response = await route.fetch();
    const wrapper =
      ";(function(){var api=window.turnstile;var render=api.render;api.render=function(container,options){" +
      "window.__turnstileRenders.push({action:options&&options.action,cData:options&&options.cData});" +
      "return render.apply(this,arguments);};})();";
    await route.fulfill({ response, body: (await response.text()) + wrapper });
  });
}

// ---------------------------------------------------------------------------------------------------------------

test.describe("lien « Prendre rendez-vous » et page 404 (critère 3)", () => {
  test("critère 3 : un type actif → lien vers /p/{slug}/rdv ; aucun type ou seulement désactivés → ni lien, ni page (404)", async ({ page }) => {
    const bookable = await bookableProfile();
    const withoutType = await createProfile();
    const inactiveOnly = await createProfile();
    await seedEventTypes(inactiveOnly.profileId, [{ ...VIDEO, is_active: false }]);

    await freshAddress(page);
    await page.goto(`/p/${bookable.slug}`);
    await expect(page.getByRole("link", { name: BOOK_LINK, exact: true })).toHaveAttribute("href", `/p/${bookable.slug}/rdv`);

    for (const profile of [withoutType, inactiveOnly]) {
      await page.goto(`/p/${profile.slug}`);
      await expect(page.getByRole("heading", { level: 1, name: FULL_PROFILE.display_name })).toBeVisible();
      await expect(page.getByRole("link", { name: BOOK_LINK, exact: true })).toHaveCount(0);
      const response = await page.goto(`/p/${profile.slug}/rdv`);
      expect(response?.status(), `/p/${profile.slug}/rdv`).toBe(404);
    }
  });

  test("critère 3 : profil non publié → /p/{slug}/rdv en 404, même avec un type actif", async ({ page }) => {
    const profile = await bookableProfile();
    const unpublished = await createProfile({ is_published: false });
    await seedEventTypes(unpublished.profileId, [VIDEO]);
    await seedRules(unpublished.profileId, EVERY_DAY);
    await openBookingPage(page, profile.slug);

    const response = await page.goto(`/p/${unpublished.slug}/rdv`);

    expect(response?.status()).toBe(404);
  });

  test("critère 3 : le lien suit les réglages du propriétaire (type créé puis désactivé dans 0038)", async ({ page }) => {
    const profile = await createProfile();
    await seedRules(profile.profileId, EVERY_DAY);
    await freshAddress(page);
    await page.goto(`/p/${profile.slug}`);
    await expect(page.getByRole("link", { name: BOOK_LINK, exact: true })).toHaveCount(0);

    await signIn(page, profile.email);
    await page.goto("/tableau-de-bord/rendez-vous/reglages");
    const types = main(page).getByRole("region", { name: "Types de rendez-vous", exact: true });
    await types.getByLabel("Titre", { exact: true }).fill("Appel découverte");
    await types.getByLabel("Durée (minutes)", { exact: true }).fill("30");
    await types.getByLabel("Lieu", { exact: true }).selectOption({ label: "Téléphone" });
    await types.getByRole("button", { name: "Ajouter le type", exact: true }).click();
    await expect(types.getByRole("listitem").filter({ hasText: "Appel découverte" })).toHaveCount(1);

    await page.goto(`/p/${profile.slug}`);
    await expect(page.getByRole("link", { name: BOOK_LINK, exact: true })).toBeVisible();

    await page.goto("/tableau-de-bord/rendez-vous/reglages");
    await types.getByRole("listitem").filter({ hasText: "Appel découverte" }).getByRole("button", { name: /^Désactiver/ }).click();
    await expect(types.getByRole("listitem").filter({ hasText: "Désactivé" })).toHaveCount(1);

    await page.goto(`/p/${profile.slug}`);
    await expect(page.getByRole("link", { name: BOOK_LINK, exact: true })).toHaveCount(0);
  });
});

test.describe("parcours de réservation (critères 1 et 4, décisions 2 à 5)", () => {
  test("critère 1 : type, jour et créneau au clavier, coordonnées → « Rendez-vous confirmé », .ics, réservation enregistrée", async ({ page }) => {
    const profile = await bookableProfile([VIDEO, VISIT]);
    const choice = target(3, "09:30");
    await openBookingPage(page, profile.slug);

    await expect(page.getByRole("heading", { level: 1 })).toContainText(FULL_PROFILE.display_name);
    await chooseSlot(page, "Appel découverte", choice);
    await fillVisitor(page);
    await waitForChallengeToken(page);
    await submit(page);

    const status = main(page).getByRole("status").filter({ hasText: CONFIRMED });
    await expect(status).toBeVisible();
    await expect(main(page)).toContainText("Appel découverte");
    await expect(main(page)).toContainText(choice.time);
    await expect(main(page)).toContainText(/e-mail/);
    await expect(main(page)).toContainText(/annul/i);

    const stored = await storedBookings(profile.profileId);
    expect(stored).toHaveLength(1);
    const [booking] = stored;
    expect(booking).toMatchObject({ status: "confirmed", event_type_id: profile.typeIds[0], visitor_name: VISITOR.name, visitor_email: VISITOR.email });
    expect(booking === undefined ? null : bookingStart(booking)).toBe(choice.start.toString());

    const [download] = await Promise.all([page.waitForEvent("download"), main(page).getByRole("link", { name: ADD_TO_CALENDAR }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.ics$/);
    const ics = await readFile((await download.path()) ?? "", "utf8");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics.replace(/\r\n[ \t]/g, "")).toContain(`DTSTART:${icsUtc(choice.start)}`);
    expect(ics).toContain("Appel découverte");
  });

  test("critère 4 : sélection au clavier — les flèches déplacent le choix du créneau", async ({ page }) => {
    const profile = await bookableProfile();
    const choice = target(3, "09:00");
    const next = target(3, "09:30");
    await openBookingPage(page, profile.slug);
    await pick(page, typeRadio(page, "Appel découverte"));
    await showDay(page, choice.day);
    await pick(page, dayRadio(page, choice.day));

    await pick(page, slotRadio(page, choice.time));
    await page.keyboard.press("ArrowDown");

    await expect(slotRadio(page, next.time)).toBeChecked();
    await expect(slotRadio(page, choice.time)).not.toBeChecked();
  });

  test("décision 4 : booking_viewed à l'ouverture, booking_started au choix d'un créneau", async ({ page }) => {
    const profile = await bookableProfile();
    await openBookingPage(page, profile.slug);

    await expect.poll(async () => (await profileEvents(profile.profileId)).map((event) => event.type)).toContain("booking_viewed");
    expect((await profileEvents(profile.profileId)).map((event) => event.type)).not.toContain("booking_started");

    await chooseSlot(page, "Appel découverte", target(3, "10:00"));

    await expect.poll(async () => (await profileEvents(profile.profileId)).map((event) => event.type)).toContain("booking_started");
    expect((await profileEvents(profile.profileId)).filter((event) => event.type === "booking_confirmed")).toStrictEqual([]);
  });

  test("critère 1 : double soumission (requête de la Server Action rejouée, même clé) → une seule réservation", async ({ page }) => {
    const profile = await bookableProfile();
    await openBookingPage(page, profile.slug);
    await chooseSlot(page, "Appel découverte", target(4, "10:30"));
    await fillVisitor(page);
    await waitForChallengeToken(page);
    let replayed = 0;
    await page.route(
      (url) => url.pathname === `/p/${profile.slug}/rdv`,
      async (route) => {
        const request = route.request();
        if (request.method() === "POST" && request.headers()["next-action"] !== undefined && (request.postData() ?? "").includes("idempotencyKey")) {
          replayed += 1;
          await page.request.fetch(request);
        }
        await route.continue();
      },
    );

    await submit(page);

    await expect(main(page).getByRole("status").filter({ hasText: CONFIRMED })).toBeVisible();
    expect(replayed, "la Server Action a été rejouée").toBe(1);
    expect(await storedBookings(profile.profileId)).toHaveLength(1);
  });

  test("décision 3 : type « téléphone » — téléphone obligatoire, réservation avec le numéro", async ({ page }) => {
    const profile = await bookableProfile([PHONE]);
    await openBookingPage(page, profile.slug);
    await chooseSlot(page, "Rappel téléphonique", target(3, "11:00"));

    await expect(field(page, /^Téléphone/)).toHaveAttribute("type", "tel");
    await expect(field(page, /^Téléphone/)).toHaveAttribute("required", "");
    await fillVisitor(page, { phone: true });
    await waitForChallengeToken(page);
    await submit(page);

    await expect(main(page).getByRole("status").filter({ hasText: CONFIRMED })).toBeVisible();
    expect((await storedBookings(profile.profileId)).map((booking) => booking.visitor_phone)).toStrictEqual([VISITOR.phone]);
  });

  test("décision 1 : widget Turnstile rendu avec action « booking » et cData = slug", async ({ page }) => {
    const profile = await bookableProfile();
    await watchTurnstileRenders(page);
    await openBookingPage(page, profile.slug);
    await chooseSlot(page, "Appel découverte", target(3, "14:00"));
    await waitForChallengeToken(page);

    const renders = await page.evaluate(() => (window as unknown as { __turnstileRenders: TurnstileRender[] }).__turnstileRenders);
    expect(renders.at(-1)).toStrictEqual({ action: "booking", cData: profile.slug });
  });

  test("0036 point 14 et audit 0037/0038 : le lien de visio n'apparaît pas, aucun href en javascript:", async ({ page }) => {
    const profile = await bookableProfile([{ ...VIDEO, location_text: "javascript:alert(1)" }, VISIT]);
    await openBookingPage(page, profile.slug);
    await pick(page, typeRadio(page, "Appel découverte"));

    const html = await page.content();
    expect(html).not.toContain("javascript:alert(1)");
    expect(await page.locator('a[href^="javascript:" i]').count()).toBe(0);
    await pick(page, typeRadio(page, "Visite de l'atelier"));
    await expect(main(page)).toContainText("12 rue des Lilas, 69003 Lyon");
    await expect(main(page).getByRole("link", { name: /12 rue des Lilas/ })).toHaveCount(0);
  });
});

test.describe("refus : rien n'est écrit, message explicite (critère 2)", () => {
  test("décision 2 : créneau pris entre l'affichage et l'envoi → message, liste relue sans ce créneau", async ({ page }) => {
    const profile = await bookableProfile();
    const choice = target(3, "15:00");
    await openBookingPage(page, profile.slug);
    await chooseSlot(page, "Appel découverte", choice);
    await fillVisitor(page);
    await waitForChallengeToken(page);
    const refusedKey = await idempotencyKeyOf(page);

    await takeSlotBehindTheApplication(profile.profileId, profile.typeIds[0] ?? "", new Date(choice.start.epochMilliseconds));
    await submit(page);

    await expect(formAlert(page).filter({ hasText: SLOT_TAKEN })).toBeVisible();
    await expect(slotRadio(page, choice.time)).toHaveCount(0);
    await expect(slotRadio(page, target(3, "15:30").time)).toHaveCount(1);
    await expect.poll(() => idempotencyKeyOf(page)).not.toBe(refusedKey);
    expect(await storedBookings(profile.profileId)).toHaveLength(1);
  });

  test("critère 2 : jeton refusé par Cloudflare (clé « toujours refusé ») → anti-robot, rien d'écrit, nouvelle clé", async ({ page }) => {
    const profile = await bookableProfile();
    await openBookingPage(page, profile.slug, refusingOrigin());
    await chooseSlot(page, "Appel découverte", target(3, "16:00"));
    await fillVisitor(page);
    await waitForChallengeToken(page);
    const refusedKey = await idempotencyKeyOf(page);

    await submit(page);

    await expect(formAlert(page).filter({ hasText: ANTI_ROBOT })).toBeVisible();
    await expect(main(page).getByRole("status").filter({ hasText: CONFIRMED })).toHaveCount(0);
    await expect.poll(() => idempotencyKeyOf(page)).not.toBe(refusedKey);
    expect(await storedBookings(profile.profileId)).toStrictEqual([]);
  });

  test("critère 4 : consentement absent, téléphone absent pour un type « téléphone » → erreurs annoncées, rien d'écrit", async ({ page }) => {
    const profile = await bookableProfile([PHONE]);
    await openBookingPage(page, profile.slug);
    await chooseSlot(page, "Rappel téléphonique", target(3, "16:30"));
    await field(page, "Nom").fill(VISITOR.name);
    await field(page, "E-mail").fill(VISITOR.email);
    await waitForChallengeToken(page);
    await bookingForm(page).evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });

    await submit(page);

    await expect(formAlert(page).filter({ hasText: CHECK_FIELDS })).toBeVisible();
    await expectAnnouncedFieldError(page, consent(page), /coch/i);
    expect(await storedBookings(profile.profileId)).toStrictEqual([]);

    await consent(page).check();
    await waitForChallengeToken(page);
    await submit(page);

    await expect(formAlert(page).filter({ hasText: CHECK_FIELDS })).toBeVisible();
    await expectAnnouncedFieldError(page, field(page, /^Téléphone/), /téléphone/i);
    expect(await storedBookings(profile.profileId)).toStrictEqual([]);
  });
});

test.describe("fuseaux horaires (décision 2, critère 4)", () => {
  test.describe("navigateur à New York, propriétaire à Tokyo", () => {
    test.use({ timezoneId: "America/New_York" });

    test("décision 2 : créneaux et jours dans le fuseau du navigateur, fuseau du propriétaire indiqué", async ({ page }) => {
      const profile = await bookableProfile([VIDEO], { timeZone: "Asia/Tokyo" });
      const choice = target(5, "09:00", "Asia/Tokyo", "America/New_York");
      await openBookingPage(page, profile.slug);

      await expect(main(page)).toContainText(/Horaires affichés dans votre fuseau horaire/);
      await expect(main(page)).toContainText("America/New_York");
      const ownerZone = main(page).getByText(new RegExp(`fuseau horaire de ${escape(FULL_PROFILE.display_name)}`));
      await expect(ownerZone).toContainText("Asia/Tokyo");

      await chooseSlot(page, "Appel découverte", choice);
      await fillVisitor(page);
      await waitForChallengeToken(page);
      await submit(page);

      await expect(main(page).getByRole("status").filter({ hasText: CONFIRMED })).toBeVisible();
      await expect(main(page)).toContainText(choice.time);
      const [stored] = await storedBookings(profile.profileId);
      expect(stored === undefined ? null : bookingStart(stored)).toBe(choice.start.toString());
    });
  });

  test("même fuseau que le propriétaire → le fuseau du propriétaire n'est pas répété", async ({ page }) => {
    const profile = await bookableProfile();
    await openBookingPage(page, profile.slug);

    await expect(main(page)).toContainText(/Horaires affichés dans votre fuseau horaire/);
    await expect(main(page)).toContainText(BROWSER_ZONE);
    await expect(main(page).getByText(new RegExp(`fuseau horaire de ${escape(FULL_PROFILE.display_name)}`))).toHaveCount(0);
  });

  test.describe("changement d'heure dans l'horizon (navigateur en UTC)", () => {
    test.use({ timezoneId: "UTC" });

    test("critère 4 (DST) : l'heure locale du propriétaire reste fixe, l'heure affichée en UTC glisse d'une heure", async ({ page }) => {
      const change = upcomingTimeChange();
      test.skip(change === null, "aucun changement d'heure entre J+2 et J+50 à la date du test (couvert par slot-days.test.ts et slots.test.ts)");
      if (change === null) return;
      const profile = await bookableProfile([VIDEO], { timeZone: change.timeZone, rules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start_time: "09:00", end_time: "10:00" })) });
      const before = localInstant(change.before, "09:00", change.timeZone);
      const after = localInstant(change.after, "09:00", change.timeZone);
      expect(timeLabel(before, "UTC")).not.toBe(timeLabel(after, "UTC"));
      await openBookingPage(page, profile.slug);
      await pick(page, typeRadio(page, "Appel découverte"));

      for (const start of [before, after]) {
        await showDay(page, dayLabel(start, "UTC"));
        await pick(page, dayRadio(page, dayLabel(start, "UTC")));
        await expect(slotRadio(page, timeLabel(start, "UTC"))).toHaveCount(1);
      }
    });
  });
});

test.describe("mention RGPD et accessibilité (décision 3, critère 4)", () => {
  test("décision 3 : mention d'information (propriétaire, 12 mois après le rendez-vous, droits, Cloudflare, Infomaniak) et case obligatoire", async ({ page }) => {
    const profile = await bookableProfile();
    await openBookingPage(page, profile.slug);
    await chooseSlot(page, "Appel découverte", target(3, "11:30"));

    const form = bookingForm(page);
    await expect(form).toContainText(FULL_PROFILE.display_name);
    await expect(form).toContainText(/12 mois après/);
    await expect(form).toContainText(/Vous pouvez demander l['’]accès à vos (données|coordonnées), leur effacement ou vous opposer à leur traitement auprès de /);
    await expect(form).toContainText("Cloudflare");
    await expect(form).toContainText(/hors de l['’]Union européenne/);
    await expect(form).toContainText("Infomaniak");
    await expect(form).toContainText(legalBasisPattern(FULL_PROFILE.display_name));
    await expect(consent(page)).not.toBeChecked();
    const required = (await consent(page).getAttribute("required")) !== null || (await consent(page).getAttribute("aria-required")) === "true";
    expect(required, "case de consentement obligatoire").toBe(true);
    await expect(consent(page)).toHaveAccessibleName(new RegExp(escape(FULL_PROFILE.display_name)));
    await expect(field(page, "E-mail")).toHaveAttribute("type", "email");
    await expect(field(page, /^Message/)).toBeVisible();
    const key = await idempotencyKeyOf(page);
    const served = await (await page.request.get(`/p/${profile.slug}/rdv`)).text();
    expect(served).not.toContain(key);
  });

  test("critère 4 : mobile — aucun défilement horizontal, choix de créneau ≥ 44 px, contrastes AA", async ({ page }) => {
    const profile = await bookableProfile();
    const choice = target(3, "09:00");
    await openBookingPage(page, profile.slug);
    await chooseSlot(page, "Appel découverte", choice);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "défilement horizontal").toBeLessThanOrEqual(0);

    const slotLabel = group(page, GROUPS.slot).locator("label").filter({ hasText: new RegExp(`^\\s*${escape(choice.time)}`) }).first();
    const box = await slotLabel.boundingBox();
    expect(box?.height ?? 0, "hauteur d'un choix de créneau").toBeGreaterThanOrEqual(MIN_TARGET_PX);

    await expectContrast(page.getByRole("heading", { level: 1 }), "titre");
    await expectContrast(slotLabel, "choix de créneau");
    await expectContrast(bookingForm(page).getByRole("button", { name: SUBMIT, exact: true }), "bouton Confirmer le rendez-vous");
    await expectContrast(bookingForm(page).getByText(/12 mois après/), "mention d'information");
    await expectContrast(main(page).getByText(/Horaires affichés dans votre fuseau horaire/), "fuseau affiché");
  });
});

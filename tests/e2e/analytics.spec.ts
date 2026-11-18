import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { IPHONE_USER_AGENT, PREVIEW_BOT_USER_AGENT, THIRD_PARTY_ORIGIN, aBeaconBody, type BeaconBody } from "../builders/analytics";
import { workerAddress } from "./helpers/accounts";
import { CONTACT_NAVIGATION_GUARD, linkIdAt, profileEvents, type EventRow } from "./helpers/analytics";
import { activateBehindTheApplication, deleteProvisionedTags, provisionTag, qrCodeOf } from "./helpers/nfc";
import { ALL_PLATFORM_LINKS, FULL_PROFILE, createProfile, type ProfileFixture } from "./helpers/public-profile";

/**
 * Contrat de la fiche 0029, figé par ces tests :
 *
 * - `/t/{uid}` (puce active) → 307 `Location: /p/{slug}?s=nfc` ; `/q/{code}` → 307 `Location: /p/{slug}?s=qr`.
 *   L'événement `nfc_scan` / `qr_scan` est écrit après la réponse (`after()`).
 * - `/p/{slug}` reste statique (`Cache-Control` sans `private` ni `no-store`, même HTML quel que soit `?s=`), ne pose
 *   aucun cookie et n'écrit rien dans `localStorage` / `sessionStorage`. Au montage, un composant client lit `?s=`,
 *   le retire de l'URL (`history.replaceState`) et envoie par `navigator.sendBeacon` à `POST /api/beacon` le JSON
 *   `{ "slug", "id" (uuid v4 généré au montage), "type": "profile_view", "source": "nfc" | "qr" | "direct" }`.
 * - Clic sur un lien de la table `links` (WhatsApp compris) → `{ …, "type": "link_click", "link_id": <id du lien>,
 *   "source": <source de la visite> }` (`id` exposé par `get_public_links`, fiche 0034) ; clic sur un champ du profil
 *   (téléphone, e-mail, site web) → `{ …, "type": "contact_click" }` sans `link_id`, même source. Un nouvel `id` par clic.
 * - Écriture par slug (`record_public_event`, fiche 0034) ; événements serveur limités à 60/h par adresse (`scan`).
 * - « Ajouter aux contacts » → un seul `vcard_download` (écrit par `/v/{slug}`, source `direct`), aucun doublon par le
 *   beacon.
 * - `POST /api/beacon` : toujours `204`, corps vide, `Cache-Control: private, no-store`, aucun `Set-Cookie`.
 * - Mention visible sur la page publique : « Mesure d'audience sans cookie » (apostrophe droite ou typographique).
 * - Les événements portent `device_class` `mobile` pour les profils Playwright (iPhone 15, Pixel 7).
 */

test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const AUDIENCE_NOTICE = /Mesure d['’]audience sans cookie/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PHONE_CONTROL = /t[ée]l[ée]phone|appeler/i;
const EMAIL_CONTROL = /e-?mail|[ée]crire/i;
const VCARD_CONTROL = /^\s*Ajouter aux contacts\s*$/;
const LINKEDIN = ALL_PLATFORM_LINKS[0]!;
const WHATSAPP = ALL_PLATFORM_LINKS.find((link) => link.platform === "whatsapp")!;
const WHATSAPP_CONTROL = /whatsapp/i;
const POLL = { timeout: 15_000 } as const;

test.afterAll(async () => {
  await deleteProvisionedTags();
});

function profilePathPattern(slug: string): RegExp {
  return new RegExp(`/p/${slug}$`);
}

/** Types of the profile's events, sorted (the order of arrival is checked separately when it matters). */
async function typesOf(profileId: string): Promise<string[]> {
  return (await profileEvents(profileId)).map((event) => event.type).sort();
}

async function eventsOfType(profileId: string, type: string): Promise<EventRow[]> {
  return (await profileEvents(profileId)).filter((event) => event.type === type);
}

async function postBeacon(
  page: Page,
  body: BeaconBody | string,
  userAgent: string = IPHONE_USER_AGENT,
  headers: Record<string, string> = {},
) {
  return page.request.post("/api/beacon", {
    headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": userAgent, ...headers },
    data: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function expectSilent204(response: Awaited<ReturnType<typeof postBeacon>>): Promise<void> {
  expect(response.status()).toBe(204);
  expect(await response.text()).toBe("");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["set-cookie"]).toBeUndefined();
}

/** A beacon from a person, then wait until it is stored: everything posted before has been handled. */
async function postControlAndWait(page: Page, profile: ProfileFixture): Promise<void> {
  const id = randomUUID();
  await expectSilent204(await postBeacon(page, aBeaconBody({ slug: profile.slug, id })));
  await expect.poll(async () => (await profileEvents(profile.profileId)).some((event) => event.id === id), POLL).toBe(true);
}

test.describe("statistiques : scans NFC et QR (0029, critère 1)", () => {
  test("critère 1 : scan NFC d'un profil publié → 307 vers /p/{slug}?s=nfc, nfc_scan puis profile_view de source nfc, ?s= retiré de l'URL", async ({
    page,
  }) => {
    const profile = await createProfile();
    const tag = await provisionTag();
    await activateBehindTheApplication(profile.email, tag);

    const scan = page.waitForResponse((response) => new URL(response.url()).pathname === `/t/${tag.uid}`);
    await page.goto(`/t/${tag.uid}`);

    expect((await scan).status()).toBe(307);
    expect((await scan).headers()["location"]).toBe(`/p/${profile.slug}?s=nfc`);
    await expect(page).toHaveURL(profilePathPattern(profile.slug));
    await expect.poll(() => typesOf(profile.profileId), POLL).toStrictEqual(["nfc_scan", "profile_view"]);
    const events = await profileEvents(profile.profileId);
    expect(events.map(({ type, source, link_id, device_class }) => ({ type, source, link_id, device_class }))).toStrictEqual([
      { type: "nfc_scan", source: "nfc", link_id: null, device_class: "mobile" },
      { type: "profile_view", source: "nfc", link_id: null, device_class: "mobile" },
    ]);
  });

  test("critère 1 : scan QR d'un profil publié → 307 vers /p/{slug}?s=qr, qr_scan puis profile_view de source qr, ?s= retiré de l'URL", async ({
    page,
  }) => {
    const profile = await createProfile();
    const code = await qrCodeOf(profile.email);

    const scan = page.waitForResponse((response) => new URL(response.url()).pathname === `/q/${code}`);
    await page.goto(`/q/${code}`);

    expect((await scan).status()).toBe(307);
    expect((await scan).headers()["location"]).toBe(`/p/${profile.slug}?s=qr`);
    await expect(page).toHaveURL(profilePathPattern(profile.slug));
    await expect.poll(() => typesOf(profile.profileId), POLL).toStrictEqual(["profile_view", "qr_scan"]);
    const events = await profileEvents(profile.profileId);
    expect(events.map(({ type, source, device_class }) => ({ type, source, device_class }))).toStrictEqual([
      { type: "qr_scan", source: "qr", device_class: "mobile" },
      { type: "profile_view", source: "qr", device_class: "mobile" },
    ]);
  });

  test("critère 3 : un aperçu de lien qui suit /t/{uid} est redirigé mais n'enregistre rien", async ({ page }) => {
    const profile = await createProfile();
    const tag = await provisionTag();
    await activateBehindTheApplication(profile.email, tag);

    const preview = await page.request.get(`/t/${tag.uid}`, {
      maxRedirects: 0,
      headers: { "user-agent": PREVIEW_BOT_USER_AGENT },
    });
    expect(preview.status()).toBe(307);
    expect(preview.headers()["location"]).toBe(`/p/${profile.slug}?s=nfc`);

    await postControlAndWait(page, profile);
    expect(await eventsOfType(profile.profileId, "nfc_scan")).toStrictEqual([]);
  });
});

test.describe("statistiques : page publique /p/{slug} (0029)", () => {
  test("décision 5 : visite directe → un profile_view de source direct ; JSON du beacon { slug, id (uuid v4), type, source }", async ({
    page,
  }) => {
    const profile = await createProfile();

    const beacon = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/beacon");
    await page.goto(`/p/${profile.slug}`);

    const request = await beacon;
    expect(request.method()).toBe("POST");
    const body = JSON.parse(request.postData() ?? "null") as Record<string, unknown>;
    expect(Object.keys(body).sort()).toStrictEqual(["id", "slug", "source", "type"]);
    expect(body).toMatchObject({ slug: profile.slug, type: "profile_view", source: "direct" });
    expect(body["id"]).toMatch(UUID_V4);
    await expect.poll(() => typesOf(profile.profileId), POLL).toStrictEqual(["profile_view"]);
    expect(await profileEvents(profile.profileId)).toMatchObject([
      { id: body["id"], type: "profile_view", source: "direct", link_id: null, device_class: "mobile" },
    ]);
  });

  test("décision 5 : ?s=nfc est lu puis retiré de l'URL (history.replaceState), sans nouvelle navigation", async ({ page }) => {
    const profile = await createProfile();
    const documents: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "document") documents.push(new URL(request.url()).search);
    });

    await page.goto(`/p/${profile.slug}?s=nfc`);

    await expect(page).toHaveURL(profilePathPattern(profile.slug));
    expect(await page.evaluate(() => window.location.search)).toBe("");
    expect(documents).toStrictEqual(["?s=nfc"]);
    await expect.poll(() => profileEvents(profile.profileId), POLL).toMatchObject([{ type: "profile_view", source: "nfc" }]);
  });

  test("critère 5 / décision 1 : page statique quel que soit ?s=, aucun cookie, aucun stockage local", async ({ page, context }) => {
    const profile = await createProfile();

    const first = await page.goto(`/p/${profile.slug}?s=qr`);
    expect(first?.status()).toBe(200);
    expect(first?.headers()["cache-control"] ?? "", "Cache-Control d'une page statique ou ISR").not.toMatch(/private|no-store/);
    expect(first?.headers()["set-cookie"]).toBeUndefined();
    await expect.poll(() => typesOf(profile.profileId), POLL).toStrictEqual(["profile_view"]);

    expect(await context.cookies()).toStrictEqual([]);
    expect(await page.evaluate(() => [document.cookie, localStorage.length, sessionStorage.length])).toStrictEqual(["", 0, 0]);

    const withNfc = await page.request.get(`/p/${profile.slug}?s=nfc`);
    const withQr = await page.request.get(`/p/${profile.slug}?s=qr`);
    const plain = await page.request.get(`/p/${profile.slug}`);
    for (const response of [withNfc, withQr, plain]) {
      expect(response.headers()["cache-control"] ?? "").not.toMatch(/private|no-store/);
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
    const html = await plain.text();
    expect(await withNfc.text(), "aucune lecture de searchParams côté serveur").toBe(html);
    expect(await withQr.text()).toBe(html);
  });

  test("décision 8 : mention d'information « Mesure d'audience sans cookie » visible sur la page publique", async ({ page }) => {
    const profile = await createProfile();

    await page.goto(`/p/${profile.slug}`);

    await expect(page.getByText(AUDIENCE_NOTICE)).toBeVisible();
  });

  test("décision 5 : clic sur un lien du profil → link_click avec l'id du lien et la source de la visite", async ({ page, context }) => {
    const profile = await createProfile({}, [LINKEDIN]);
    const linkId = await linkIdAt(profile.profileId, 0);
    await context.route(/^https:\/\/www\.linkedin\.com\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>externe</title>" }));
    await page.goto(`/p/${profile.slug}?s=qr`);
    await expect.poll(() => typesOf(profile.profileId), POLL).toStrictEqual(["profile_view"]);

    const popup = context.waitForEvent("page");
    await page.locator(`a[href="${LINKEDIN.url}"]`).click();
    await (await popup).close();

    await expect.poll(() => typesOf(profile.profileId), POLL).toStrictEqual(["link_click", "profile_view"]);
    const [click] = await eventsOfType(profile.profileId, "link_click");
    const [view] = await eventsOfType(profile.profileId, "profile_view");
    expect(click).toMatchObject({ link_id: linkId, source: "qr", device_class: "mobile" });
    expect(click?.id).not.toBe(view?.id);
  });

  test("décision 9 : clic sur le contrôle WhatsApp (lien de la table links) → link_click avec l'id du lien", async ({ page }) => {
    const profile = await createProfile({}, [WHATSAPP]);
    const linkId = await linkIdAt(profile.profileId, 0);
    await page.addInitScript(CONTACT_NAVIGATION_GUARD);
    await page.goto(`/p/${profile.slug}?s=nfc`);
    await expect.poll(() => typesOf(profile.profileId), POLL).toStrictEqual(["profile_view"]);

    await page.getByRole("button", { name: WHATSAPP_CONTROL }).or(page.getByRole("link", { name: WHATSAPP_CONTROL })).first().click();

    await expect.poll(() => eventsOfType(profile.profileId, "link_click"), POLL).toMatchObject([
      { link_id: linkId, source: "nfc", device_class: "mobile" },
    ]);
    expect(await eventsOfType(profile.profileId, "contact_click")).toStrictEqual([]);
  });

  test("décision 9 : clic sur téléphone, e-mail puis site web (champs du profil) → trois contact_click sans lien, source de la visite, ids distincts", async ({
    page,
    context,
  }) => {
    const profile = await createProfile();
    const websiteHost = new URL(FULL_PROFILE.website_url!).hostname;
    await context.route((url) => url.hostname === websiteHost, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>externe</title>" }));
    await page.addInitScript(CONTACT_NAVIGATION_GUARD);
    await page.goto(`/p/${profile.slug}?s=qr`);
    await expect.poll(() => typesOf(profile.profileId), POLL).toStrictEqual(["profile_view"]);

    await page.getByRole("button", { name: PHONE_CONTROL }).or(page.getByRole("link", { name: PHONE_CONTROL })).first().click();
    await expect.poll(async () => (await eventsOfType(profile.profileId, "contact_click")).length, POLL).toBe(1);
    await page.getByRole("button", { name: EMAIL_CONTROL }).or(page.getByRole("link", { name: EMAIL_CONTROL })).first().click();
    await expect.poll(async () => (await eventsOfType(profile.profileId, "contact_click")).length, POLL).toBe(2);
    const popup = context.waitForEvent("page");
    await page.locator(`a[href="${FULL_PROFILE.website_url}"]`).click();
    await (await popup).close();

    await expect.poll(async () => (await eventsOfType(profile.profileId, "contact_click")).length, POLL).toBe(3);
    const clicks = await eventsOfType(profile.profileId, "contact_click");
    expect(clicks).toMatchObject([
      { link_id: null, source: "qr" },
      { link_id: null, source: "qr" },
      { link_id: null, source: "qr" },
    ]);
    expect(new Set(clicks.map((event) => event.id)).size).toBe(3);
    expect(await eventsOfType(profile.profileId, "link_click")).toStrictEqual([]);
  });

  test("décision 4 : « Ajouter aux contacts » → un seul vcard_download de source direct", async ({ page }) => {
    const profile = await createProfile();
    await page.goto(`/p/${profile.slug}`);
    await expect.poll(() => typesOf(profile.profileId), POLL).toStrictEqual(["profile_view"]);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: VCARD_CONTROL }).or(page.getByRole("link", { name: VCARD_CONTROL })).first().click();
    await download;

    await expect.poll(() => eventsOfType(profile.profileId, "vcard_download"), POLL).toMatchObject([
      { source: "direct", link_id: null, device_class: "mobile" },
    ]);
    await postControlAndWait(page, profile);
    expect(await eventsOfType(profile.profileId, "vcard_download")).toHaveLength(1);
  });
});

test.describe("statistiques : POST /api/beacon (0029, décision 6)", () => {
  test("critère 2 : la même requête de beacon rejouée (même id) ne crée qu'un événement", async ({ page }) => {
    const profile = await createProfile();
    const body = aBeaconBody({ slug: profile.slug, id: randomUUID(), source: "qr" });

    await expectSilent204(await postBeacon(page, body));
    await expectSilent204(await postBeacon(page, body));

    await postControlAndWait(page, profile);
    expect((await profileEvents(profile.profileId)).filter((event) => event.id === body.id)).toMatchObject([
      { type: "profile_view", source: "qr" },
    ]);
  });

  test("critère 3 : user-agent d'aperçu de lien → 204, aucun événement", async ({ page }) => {
    const profile = await createProfile();
    const body = aBeaconBody({ slug: profile.slug, id: randomUUID() });

    await expectSilent204(await postBeacon(page, body, PREVIEW_BOT_USER_AGENT));

    await postControlAndWait(page, profile);
    expect((await profileEvents(profile.profileId)).map((event) => event.id)).not.toContain(body.id);
  });

  test("point 10 : beacon posté depuis une page tierce (Origin tiers, Sec-Fetch-Site cross-site) → 204, aucun événement", async ({
    page,
  }) => {
    const profile = await createProfile();
    const fromOrigin = aBeaconBody({ slug: profile.slug, id: randomUUID() });
    const fromFetchSite = aBeaconBody({ slug: profile.slug, id: randomUUID() });

    await expectSilent204(await postBeacon(page, fromOrigin, IPHONE_USER_AGENT, { origin: THIRD_PARTY_ORIGIN }));
    await expectSilent204(await postBeacon(page, fromFetchSite, IPHONE_USER_AGENT, { "sec-fetch-site": "cross-site" }));

    await postControlAndWait(page, profile);
    const ids = (await profileEvents(profile.profileId)).map((event) => event.id);
    expect(ids).not.toContain(fromOrigin.id);
    expect(ids).not.toContain(fromFetchSite.id);
  });

  test("décision 6 : slug inconnu, profil non publié, JSON invalide, type réservé au serveur → même 204, rien d'enregistré", async ({
    page,
  }) => {
    const unpublished = await createProfile({ is_published: false });
    const reference = await postBeacon(page, aBeaconBody({ slug: "inconnu-e2e-0029", id: randomUUID() }));
    await expectSilent204(reference);

    for (const body of [
      aBeaconBody({ slug: unpublished.slug, id: randomUUID() }),
      aBeaconBody({ slug: unpublished.slug, id: randomUUID(), type: "nfc_scan" }),
      "{",
    ]) {
      await expectSilent204(await postBeacon(page, body));
    }
    expect(await profileEvents(unpublished.profileId)).toStrictEqual([]);
  });
});

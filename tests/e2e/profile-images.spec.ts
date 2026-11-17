import { expect, test, type Locator, type Page } from "@playwright/test";

import { IMAGE_ERROR_MESSAGES } from "../../src/ui/features/profile-editor/messages";
import { workerAddress } from "./helpers/accounts";
import { signInAs } from "./helpers/profile-editor";
import {
  deleteFolder,
  exifTracesOf,
  FAKE_PNG,
  formatOf,
  imageColumnsOf,
  type ImageColumns,
  MEDIA_BUCKET,
  objectsOf,
  photoWithGpsExif,
  publicMediaUrl,
} from "./helpers/profile-images";
import { createProfile, FULL_PROFILE, FULL_PROFILE_INITIALS, type ProfileFixture } from "./helpers/public-profile";
import { unfoldVCard } from "./helpers/vcard";

/**
 * Contrat de balisage des images du profil (fiche 0021), figé par ces tests :
 *
 * Éditeur `/tableau-de-bord/profil` (panneau « Modifier »)
 * - Un `<input type="file">` natif par image, libellé exact : « Photo de profil », « Bannière », « Logo » ;
 *   `accept` limité à `image/jpeg,image/png,image/webp` (dans un ordre quelconque).
 * - Choisir un fichier suffit : le navigateur le redimensionne (avatar et logo 512 px au plus, bannière 1500 px de
 *   large au plus), le ré-encode en JPEG ou WebP (jamais PNG : WebKit ne sait pas produire de WebP par le canvas,
 *   il faut alors du JPEG) puis appelle `uploadProfileImageAction` ; aucun clic sur « Enregistrer ».
 * - Image présente : bouton exact « Supprimer la photo de profil » (« Supprimer la bannière », « Supprimer le logo »).
 * - Refus : `role="alert"` contenant le message `IMAGE_ERROR_MESSAGES` du code (fichier non décodable par le
 *   navigateur compris → message `invalid_file`).
 * - Décision 12 : pendant un envoi (de la sélection à la réponse de l'action), le champ de fichier concerné est
 *   `disabled` ; aide permanente contenant « JPEG, PNG ou WebP » dans la description accessible de chaque champ
 *   (`aria-describedby`, conservée en cas d'erreur) ; texte exact « Ces images sont visibles publiquement. ».
 *
 * Aperçu (région « Aperçu », bouton « Aperçu » sur petit écran) et page publique `/p/{slug}`
 * - Avatar : `img` décoratif `alt=""` (décision 12 : le nom suit en titre), `src` = URL publique de l'objet
 *   (`<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/carnet-media/<nom>`), à la place des initiales.
 * - Logo : `img` d'`alt` exact « Logo de <entreprise> » si l'entreprise est renseignée, « Logo » sinon.
 * - `<meta property="og:image">` de la page publique = cette même URL.
 * - vCard `/v/{slug}` : `PHOTO;ENCODING=b;TYPE=JPEG|WEBP:<base64 du fichier stocké>`.
 */

test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const EDITOR_PATH = "/tableau-de-bord/profil";
const AVATAR_INPUT = "Photo de profil";
const IMAGE_INPUTS = ["Photo de profil", "Bannière", "Logo"] as const;
const FORMATS_HELP = "JPEG, PNG ou WebP";
const PUBLIC_NOTICE = "Ces images sont visibles publiquement.";
const REMOVE_AVATAR = "Supprimer la photo de profil";
const AVATAR_MAX_PX = 512;
const DISPLAY_NAME = FULL_PROFILE.display_name;

const created: ProfileFixture[] = [];

test.afterEach(async () => {
  for (const fixture of created.splice(0)) {
    await deleteFolder(fixture.profileId);
  }
});

async function newPublishedProfile(): Promise<ProfileFixture> {
  const fixture = await createProfile();
  created.push(fixture);
  return fixture;
}

async function openEditor(page: Page, fixture: ProfileFixture): Promise<void> {
  await signInAs(page, fixture.email);
  await page.goto(EDITOR_PATH);
  await expect(page).toHaveURL(new RegExp(`${EDITOR_PATH}$`));
}

/** Small screens toggle between the form and the preview; wide screens show both. */
async function showPanel(page: Page, name: "Modifier" | "Aperçu"): Promise<void> {
  const toggle = page.getByRole("button", { name, exact: true });
  if (await toggle.isVisible()) {
    await toggle.click();
  }
}

function preview(page: Page): Locator {
  return page.getByRole("region", { name: "Aperçu", exact: true });
}

async function chooseAvatar(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await showPanel(page, "Modifier");
  await page.getByLabel(AVATAR_INPUT, { exact: true }).setInputFiles(file);
}

/** Waits until `column` differs from `previous` (the Server Action has recorded the new object). */
async function imageChangedFrom(
  profileId: string,
  column: keyof ImageColumns,
  previous: string | null,
): Promise<string | null> {
  await expect
    .poll(async () => (await imageColumnsOf(profileId))[column], { message: `${column} mis à jour`, timeout: 15_000 })
    .not.toBe(previous);
  return (await imageColumnsOf(profileId))[column];
}

async function avatarChangedFrom(profileId: string, previous: string | null): Promise<string | null> {
  return imageChangedFrom(profileId, "avatar_url", previous);
}

/** The avatar is decorative (`alt=""`, decision 12): found by its public URL, not by an accessible name. */
function avatarImage(scope: Page | Locator): Locator {
  return scope.locator(`img[src*="/storage/v1/object/public/${MEDIA_BUCKET}/"][src*="/avatar-"]`);
}

async function download(url: string): Promise<{ status: number; bytes: Uint8Array }> {
  const response = await fetch(url);
  return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
}

async function naturalSizeOf(page: Page, url: string): Promise<{ width: number; height: number }> {
  return page.evaluate(
    (src) =>
      new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error(`image not decodable: ${src}`));
        image.src = src;
      }),
    url,
  );
}

test.describe("images du profil (0021)", () => {
  test("critères 1 et 3 : téléverser une photo → aperçu, page publique (à la place des initiales, og:image) et vCard (PHOTO)", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const fixture = await newPublishedProfile();
    await openEditor(page, fixture);

    await chooseAvatar(page, { name: "vacances.png", mimeType: "image/png", buffer: photoWithGpsExif() });
    const name = await avatarChangedFrom(fixture.profileId, null);

    expect(name).toMatch(
      new RegExp(`^${fixture.profileId}/avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|webp)$`),
    );
    const url = publicMediaUrl(name ?? "");
    expect(await objectsOf(fixture.profileId)).toStrictEqual([name]);

    await showPanel(page, "Aperçu");
    await expect(avatarImage(preview(page))).toHaveAttribute("src", url);
    await expect(preview(page).getByText(FULL_PROFILE_INITIALS, { exact: true })).toHaveCount(0);

    await page.goto(`/p/${fixture.slug}`);
    await expect(avatarImage(page)).toHaveAttribute("src", url);
    await expect(page.getByText(FULL_PROFILE_INITIALS, { exact: true })).toHaveCount(0);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", url);

    const stored = await download(url);
    expect(stored.status).toBe(200);
    const vcard = await request.get(`/v/${fixture.slug}`);
    expect(vcard.status()).toBe(200);
    const photo = unfoldVCard((await vcard.body()).toString("utf8")).find((line) => line.startsWith("PHOTO"));
    expect(photo).toMatch(/^PHOTO;ENCODING=b;TYPE=(JPEG|WEBP):[A-Za-z0-9+/]+=*$/);
    expect(photo?.startsWith(`PHOTO;ENCODING=b;TYPE=${formatOf(stored.bytes).toUpperCase()}:`)).toBe(true);
    expect([...Buffer.from(photo?.split(":")[1] ?? "", "base64")]).toStrictEqual([...stored.bytes]);
  });

  test("critère 2 : le fichier stocké est ré-encodé (JPEG ou WebP), réduit à 512 px et sans les métadonnées EXIF/GPS de la photo", async ({
    page,
  }) => {
    const fixture = await newPublishedProfile();
    await openEditor(page, fixture);
    const source = photoWithGpsExif(1200, 900);
    expect(exifTracesOf(source)).toContain("eXIf");

    await chooseAvatar(page, { name: "gps.png", mimeType: "image/png", buffer: source });
    const name = await avatarChangedFrom(fixture.profileId, null);

    const stored = await download(publicMediaUrl(name ?? ""));
    expect(stored.status).toBe(200);
    expect(["jpeg", "webp"]).toContain(formatOf(stored.bytes));
    expect(exifTracesOf(stored.bytes)).toStrictEqual([]);
    const size = await naturalSizeOf(page, publicMediaUrl(name ?? ""));
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(AVATAR_MAX_PX);
    expect(size.width / size.height).toBeCloseTo(1200 / 900, 1);
  });

  test("critère 1 : remplacer la photo → l'ancien fichier n'est plus servi, seul le nouveau reste", async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await newPublishedProfile();
    await openEditor(page, fixture);
    await chooseAvatar(page, { name: "premiere.png", mimeType: "image/png", buffer: photoWithGpsExif(800, 800, [200, 30, 30]) });
    const first = await avatarChangedFrom(fixture.profileId, null);

    await chooseAvatar(page, { name: "seconde.png", mimeType: "image/png", buffer: photoWithGpsExif(800, 800, [30, 30, 200]) });
    const second = await avatarChangedFrom(fixture.profileId, first);

    expect(second).not.toBeNull();
    await expect.poll(() => objectsOf(fixture.profileId)).toStrictEqual([second]);
    expect((await download(publicMediaUrl(first ?? ""))).status).not.toBe(200);
    expect((await download(publicMediaUrl(second ?? ""))).status).toBe(200);

    await page.goto(`/p/${fixture.slug}`);
    await expect(avatarImage(page)).toHaveAttribute("src", publicMediaUrl(second ?? ""));
  });

  test("critère 1 : supprimer la photo → initiales de nouveau dans l'aperçu et sur la page publique, fichier supprimé", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const fixture = await newPublishedProfile();
    await openEditor(page, fixture);
    await chooseAvatar(page, { name: "moi.png", mimeType: "image/png", buffer: photoWithGpsExif(600, 600) });
    const name = await avatarChangedFrom(fixture.profileId, null);
    await page.goto(`/p/${fixture.slug}`);
    await expect(avatarImage(page)).toBeVisible();

    await page.goto(EDITOR_PATH);
    await showPanel(page, "Modifier");
    await page.getByRole("button", { name: REMOVE_AVATAR, exact: true }).click();
    await avatarChangedFrom(fixture.profileId, name);

    expect((await imageColumnsOf(fixture.profileId)).avatar_url).toBeNull();
    await expect.poll(() => objectsOf(fixture.profileId)).toStrictEqual([]);
    expect((await download(publicMediaUrl(name ?? ""))).status).not.toBe(200);
    await showPanel(page, "Aperçu");
    await expect(preview(page).getByText(FULL_PROFILE_INITIALS, { exact: true })).toBeVisible();
    await expect(avatarImage(preview(page))).toHaveCount(0);

    await page.goto(`/p/${fixture.slug}`);
    await expect(page.getByText(FULL_PROFILE_INITIALS, { exact: true })).toBeVisible();
    await expect(avatarImage(page)).toHaveCount(0);
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
    const vcard = await request.get(`/v/${fixture.slug}`);
    expect(unfoldVCard((await vcard.body()).toString("utf8")).some((line) => line.startsWith("PHOTO"))).toBe(false);
  });

  test("critère 2 : un faux fichier (texte renommé .png) est refusé avec un message en français, rien n'est stocké", async ({
    page,
  }) => {
    const fixture = await newPublishedProfile();
    await openEditor(page, fixture);

    await chooseAvatar(page, FAKE_PNG);

    await expect(page.getByRole("alert").filter({ hasText: IMAGE_ERROR_MESSAGES.invalid_file })).toBeVisible();
    expect((await imageColumnsOf(fixture.profileId)).avatar_url).toBeNull();
    expect(await objectsOf(fixture.profileId)).toStrictEqual([]);
    await expect(page.getByRole("button", { name: REMOVE_AVATAR, exact: true })).toHaveCount(0);
    await expect(page.getByLabel(AVATAR_INPUT, { exact: true })).toHaveAccessibleDescription(new RegExp(FORMATS_HELP));
  });

  test("le sélecteur de fichier n'accepte que JPEG, PNG et WebP", async ({ page }) => {
    const fixture = await newPublishedProfile();
    await openEditor(page, fixture);
    await showPanel(page, "Modifier");

    for (const label of ["Photo de profil", "Bannière", "Logo"]) {
      const accept = await page.getByLabel(label, { exact: true }).getAttribute("accept");
      expect((accept ?? "").split(",").map((type) => type.trim()).sort(), label).toStrictEqual([
        "image/jpeg",
        "image/png",
        "image/webp",
      ]);
    }
  });

  test("décision 12 : pendant un envoi, le champ de fichier concerné est désactivé, puis de nouveau actif", async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await newPublishedProfile();
    await openEditor(page, fixture);
    let heldActions = 0;
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"] !== undefined) {
        heldActions += 1;
        await released;
      }
      await route.continue();
    });

    await chooseAvatar(page, { name: "lent.png", mimeType: "image/png", buffer: photoWithGpsExif(600, 600) });
    await expect.poll(() => heldActions, { message: "action d'envoi en attente" }).toBe(1);
    const input = page.getByLabel(AVATAR_INPUT, { exact: true });

    await expect(input).toBeDisabled();
    release();
    const name = await avatarChangedFrom(fixture.profileId, null);
    await expect(input).toBeEnabled();
    expect(await objectsOf(fixture.profileId)).toStrictEqual([name]);
  });

  test("décision 12 : mention « Ces images sont visibles publiquement. » et aide « JPEG, PNG ou WebP » reliée à chaque champ", async ({
    page,
  }) => {
    const fixture = await newPublishedProfile();
    await openEditor(page, fixture);
    await showPanel(page, "Modifier");

    await expect(page.getByText(PUBLIC_NOTICE, { exact: true })).toBeVisible();
    for (const label of IMAGE_INPUTS) {
      const input = page.getByLabel(label, { exact: true });
      await expect(input, label).toHaveAttribute("aria-describedby", /\S/);
      await expect(input, label).toHaveAccessibleDescription(new RegExp(FORMATS_HELP));
    }
  });

  test("décision 12 : avatar décoratif (alt vide), logo « Logo de <entreprise> » dans l'aperçu et sur la page publique", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const fixture = await newPublishedProfile();
    await openEditor(page, fixture);
    await chooseAvatar(page, { name: "moi.png", mimeType: "image/png", buffer: photoWithGpsExif(600, 600) });
    const avatar = await avatarChangedFrom(fixture.profileId, null);
    await showPanel(page, "Modifier");
    await page.getByLabel("Logo", { exact: true }).setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: photoWithGpsExif(400, 400, [10, 10, 10]),
    });
    const logo = await imageChangedFrom(fixture.profileId, "logo_url", null);
    const logoAlt = `Logo de ${FULL_PROFILE.company ?? ""}`;

    await showPanel(page, "Aperçu");
    await expect(avatarImage(preview(page))).toHaveAttribute("alt", "");
    await expect(preview(page).getByRole("img", { name: logoAlt, exact: true })).toHaveAttribute(
      "src",
      publicMediaUrl(logo ?? ""),
    );

    await page.goto(`/p/${fixture.slug}`);
    await expect(avatarImage(page)).toHaveAttribute("src", publicMediaUrl(avatar ?? ""));
    await expect(avatarImage(page)).toHaveAttribute("alt", "");
    await expect(page.getByRole("img", { name: DISPLAY_NAME })).toHaveCount(0);
    await expect(page.getByRole("img", { name: logoAlt, exact: true })).toHaveAttribute("src", publicMediaUrl(logo ?? ""));
  });

  test("décision 12 : sans entreprise, le logo a pour texte alternatif « Logo »", async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await createProfile({ company: null });
    created.push(fixture);
    await openEditor(page, fixture);
    await showPanel(page, "Modifier");
    await page.getByLabel("Logo", { exact: true }).setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: photoWithGpsExif(400, 400, [10, 10, 10]),
    });
    const logo = await imageChangedFrom(fixture.profileId, "logo_url", null);

    await page.goto(`/p/${fixture.slug}`);
    await expect(page.getByRole("img", { name: "Logo", exact: true })).toHaveAttribute("src", publicMediaUrl(logo ?? ""));
  });
});

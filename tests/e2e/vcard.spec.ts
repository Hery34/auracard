import { expect, test } from "@playwright/test";

import { newClientAddress, workerAddress } from "./helpers/accounts";
import { createProfile, expectNoStoreNoIndex, expectSecurityHeaders, unfoldVCard } from "./helpers/vcard";

/** Under `pnpm start` the `vcard` counter is keyed on this header: one bucket per worker, never the shared "unknown". */
test.use({ extraHTTPHeaders: { "x-forwarded-for": workerAddress() } });

const VCARD_LIMIT_PER_HOUR = 30;

const FIELDS = {
  job_title: "Architecte d'intérieur",
  company: "Atelier Mérel, Lyon",
  bio: "Aménagement d'espaces 🌿\nsur mesure.",
  contact_email: "elodie@atelier-merel.example",
  phone: "+33 6 12 34 56 78",
  website_url: "https://atelier-merel.example/",
} as const;

test.describe("vCard /v/{slug}", () => {
  test("critère 2 : profil publié → 200, en-têtes attendus et vCard 3.0 analysable", async ({ request }) => {
    const account = await createProfile({ published: true, fields: FIELDS });

    const response = await request.get(`/v/${account.slug}`, { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("text/vcard; charset=utf-8");
    expect(response.headers()["content-disposition"]).toBe(`attachment; filename="${account.slug}.vcf"`);
    expectSecurityHeaders(response);

    const content = (await response.body()).toString("utf8");
    expect(content.startsWith("BEGIN:VCARD\r\n")).toBe(true);
    expect(content.endsWith("END:VCARD\r\n")).toBe(true);
    for (const line of content.slice(0, -2).split("\r\n")) {
      expect.soft(Buffer.byteLength(line, "utf8"), JSON.stringify(line)).toBeLessThanOrEqual(75);
    }

    const lines = unfoldVCard(content);
    expect(lines[0]).toBe("BEGIN:VCARD");
    expect(lines[1]).toBe("VERSION:3.0");
    expect(lines.at(-1)).toBe("END:VCARD");
    expect(lines).toContain(`N:${account.displayName};;;;`);
    expect(lines).toContain(`FN:${account.displayName}`);
    expect(lines).toContain("ORG:Atelier Mérel\\, Lyon");
    expect(lines).toContain("TITLE:Architecte d'intérieur");
    expect(lines).toContain("EMAIL;TYPE=INTERNET:elodie@atelier-merel.example");
    expect(lines).toContain("TEL;TYPE=CELL:+33 6 12 34 56 78");
    expect(lines).toContain("NOTE:Aménagement d'espaces 🌿\\nsur mesure.");

    const urls = lines.filter((line) => line.startsWith("URL:")).map((line) => line.slice("URL:".length));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("https://atelier-merel.example/");
    expect(new URL(urls[1] ?? "").pathname).toBe(`/p/${account.slug}`);
    expect(lines.some((line) => line.startsWith("PHOTO"))).toBe(false);
  });

  test("critère 2 : profil non publié → 404 sans aucune donnée du profil", async ({ request }) => {
    const account = await createProfile({ published: false, fields: FIELDS });

    const response = await request.get(`/v/${account.slug}`, { maxRedirects: 0 });

    expect(response.status()).toBe(404);
    expect(response.headers()["content-disposition"]).toBeUndefined();
    expectSecurityHeaders(response);
    const body = await response.text();
    expect(body).not.toContain("BEGIN:VCARD");
    expect(body).not.toContain(account.displayName);
    expect(body).not.toContain(FIELDS.contact_email);
    expect(body).not.toContain(FIELDS.phone);
  });

  test("critère 2 : slug inexistant → 404", async ({ request }) => {
    const response = await request.get("/v/e2e-slug-inexistant-0019", { maxRedirects: 0 });

    expect(response.status()).toBe(404);
    expect(response.headers()["content-disposition"]).toBeUndefined();
    expect(await response.text()).not.toContain("BEGIN:VCARD");
  });

  test("décision 7 : 200 et 404 — Cache-Control « private, no-store » et X-Robots-Tag « noindex »", async ({ request }) => {
    const published = await createProfile({ published: true });
    const unpublished = await createProfile({ published: false });

    const ok = await request.get(`/v/${published.slug}`, { maxRedirects: 0 });
    const hidden = await request.get(`/v/${unpublished.slug}`, { maxRedirects: 0 });
    const missing = await request.get("/v/e2e-slug-inexistant-0019", { maxRedirects: 0 });

    expect(ok.status()).toBe(200);
    expect(hidden.status()).toBe(404);
    expect(missing.status()).toBe(404);
    for (const response of [ok, hidden, missing]) {
      expectNoStoreNoIndex(response);
    }
  });

  test("slug invalide ou réservé → 404", async ({ request }) => {
    for (const slug of ["Elodie", "tableau-de-bord", "a"]) {
      const response = await request.get(`/v/${slug}`, { maxRedirects: 0 });

      expect.soft(response.status(), slug).toBe(404);
    }
  });

  test("rejoué : deux téléchargements successifs donnent le même fichier", async ({ request }) => {
    const account = await createProfile({ published: true });

    const first = await request.get(`/v/${account.slug}`);
    const second = await request.get(`/v/${account.slug}`);

    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    expect((await second.body()).equals(await first.body())).toBe(true);
  });

  test("limite vcard : la 31e requête d'une même adresse → 429 sans contenu, une autre adresse reste servie", async ({
    request,
  }) => {
    const account = await createProfile({ published: true, fields: FIELDS });
    const limited = { "x-forwarded-for": newClientAddress() };

    for (let attempt = 1; attempt <= VCARD_LIMIT_PER_HOUR; attempt += 1) {
      const response = await request.get(`/v/${account.slug}`, { headers: limited, maxRedirects: 0 });
      expect(response.status(), `requête ${attempt}`).toBe(200);
    }

    const rejected = await request.get(`/v/${account.slug}`, { headers: limited, maxRedirects: 0 });

    expect(rejected.status()).toBe(429);
    expect(rejected.headers()["content-disposition"]).toBeUndefined();
    expectSecurityHeaders(rejected);
    expectNoStoreNoIndex(rejected);
    const body = await rejected.text();
    expect(body).not.toContain("BEGIN:VCARD");
    expect(body).not.toContain(account.displayName);
    expect(body).not.toContain(FIELDS.contact_email);
    expect(body).not.toContain(FIELDS.phone);

    const other = await request.get(`/v/${account.slug}`, {
      headers: { "x-forwarded-for": newClientAddress() },
      maxRedirects: 0,
    });
    expect(other.status()).toBe(200);
    expect(unfoldVCard((await other.body()).toString("utf8"))).toContain(`FN:${account.displayName}`);
  });
});

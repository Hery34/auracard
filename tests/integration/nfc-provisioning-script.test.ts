/**
 * 0025 — decision 9 and criterion 6: `supabase/scripts/provision_nfc_tags.sql`, run with `psql` as `postgres` on the
 * local stack exactly as Hery runs it (no service_role key outside the server, ADR 0011 precision of 17/11/2026).
 *
 * Contract frozen by test-engineer:
 * // psql "<database url>" -X -v count=<n> -v site_url=<https://…> -v out=<file outside the repository> \
 * //      -f supabase/scripts/provision_nfc_tags.sql
 * // - count, site_url and out are mandatory: a missing one → non-zero exit status, no tag created, no file written
 * //   (the script stops on its own: ON_ERROR_STOP set inside the script, nothing to pass on the command line);
 * // - count outside 1..500 or not a number → non-zero exit status, no tag created;
 * // - a fresh batch_id is generated on every run and printed on the standard output;
 * // - the file `out` is a CSV with the header `url,activation_code` then exactly `count` lines
 * //   `<site_url>/t/<uid>,<XXXXX-XXXXX>` (upper-case code), one per tag of that batch, all in stock;
 * // - the activation codes are written to the file only: never on the standard output nor the error output.
 * // Decision 13: `out` empty or starting with "|" → refused; `site_url` must match ^https://[a-z0-9.-]+(:[0-9]+)?/?$
 * //   (https only, no path) → else refused; provisioning and CSV writing in one transaction: a failed write leaves
 * //   no tag of the batch.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ok } from "@/domain/shared/result";
import { makeSupabaseAuthGateway } from "@/server/infrastructure/supabase/auth-gateway";
import { makeSupabaseMembershipReader } from "@/server/repositories/supabase-membership-reader";
import { makeSupabaseNfcTagRepository } from "@/server/repositories/supabase-nfc-tag-repository";
import { makeSupabaseRateLimiter } from "@/server/repositories/supabase-rate-limiter";
import { makeActivateNfcTag } from "@/server/use-cases/activate-nfc-tag";

import { deleteUsersByEmail } from "./setup/cleanup";
import { adminClient } from "./setup/clients";
import { RUN_SECRET, uniqueAddress } from "./setup/fixtures";
import { createMember } from "./setup/members";
import { countTags, deleteBatches, tagsOfBatch } from "./setup/nfc";
import { assertLocalSupabaseUrl } from "./setup/supabase-env";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(REPOSITORY_ROOT, "supabase/scripts/provision_nfc_tags.sql");
const SITE_URL = "https://carnet.example";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const CSV_LINE = /^https:\/\/carnet\.example\/t\/([0-9a-hjkmnp-tv-z]{12}),([0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})$/;
const CODE_ANYWHERE = /[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}/i;

/** `DB_URL` of `supabase status` (or SUPABASE_DB_URL), local host only: the script writes real tags. */
function databaseUrl(): string {
  const preset = process.env.SUPABASE_DB_URL;
  const url =
    preset !== undefined && preset !== ""
      ? preset
      : /^DB_URL="?([^"\n]+)"?$/m.exec(
          execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
        )?.[1];
  if (url === undefined) {
    throw new Error("DB_URL absent de `supabase status -o env` : pile locale démarrée ?");
  }
  assertLocalSupabaseUrl(url.replace(/^postgres(ql)?:/, "http:"));
  return url;
}

type Run = { status: number | null; stdout: string; stderr: string };

function runScript(variables: Record<string, string>): Run {
  const args = [databaseUrl(), "-X", "-f", SCRIPT];
  for (const [name, value] of Object.entries(variables)) {
    args.push("-v", `${name}=${value}`);
  }
  const result = spawnSync("psql", args, { encoding: "utf8", cwd: REPOSITORY_ROOT, timeout: 60_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function batchIdsIn(output: string): string[] {
  return [...new Set(output.match(UUID) ?? [])];
}

type CsvRow = { url: string; uid: string; activationCode: string };

function readCsv(file: string): { header: string; rows: CsvRow[]; raw: string[] } {
  const [header = "", ...lines] = readFileSync(file, "utf8").replace(/\r?\n$/, "").split(/\r?\n/);
  const rows = lines.map((line) => {
    const match = CSV_LINE.exec(line);
    expect(match, `CSV line ${JSON.stringify(line)}`).not.toBeNull();
    return { url: line.split(",")[0] ?? "", uid: match?.[1] ?? "", activationCode: match?.[2] ?? "" };
  });
  return { header, rows, raw: lines };
}

describe("supabase/scripts/provision_nfc_tags.sql (psql as postgres)", () => {
  const admin = adminClient();
  const batches: string[] = [];
  const emails: string[] = [];
  let directory = "";

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "carnet-nfc-provisioning-"));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  afterEach(async () => {
    await deleteBatches(admin, batches.splice(0));
    await deleteUsersByEmail(admin, emails.splice(0));
  });

  function outFile(name: string): string {
    return path.join(directory, name);
  }

  /** Runs the script, records every printed batch id for the cleanup. */
  function provision(variables: Record<string, string>): Run {
    const run = runScript(variables);
    batches.push(...batchIdsIn(run.stdout));
    return run;
  }

  it("the script is versioned at supabase/scripts/provision_nfc_tags.sql with a usage header (exact command, warning)", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const source = readFileSync(SCRIPT, "utf8");
    expect(source).toMatch(/\bpsql\b/);
    for (const variable of ["count", "site_url", "out"]) {
      expect(source).toMatch(new RegExp(`-v\\s+${variable}=`));
    }
    expect(source).toMatch(/une seule fois/i);
    expect(source).toMatch(/d[ée]truire/i);
  });

  it("criterion 6: count lines `<site_url>/t/<uid>,<XXXXX-XXXXX>`, all tags in stock in the printed batch", async () => {
    const out = outFile("lot-a.csv");

    const run = provision({ count: "3", site_url: SITE_URL, out });

    expect(run.status, run.stderr).toBe(0);
    const printed = batchIdsIn(run.stdout);
    expect(printed).toHaveLength(1);
    const { header, rows } = readCsv(out);
    expect(header).toBe("url,activation_code");
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.uid)).size).toBe(3);
    expect(new Set(rows.map((row) => row.activationCode)).size).toBe(3);
    const stored = await tagsOfBatch(admin, printed[0] ?? "");
    expect(stored.map((tag) => tag.uid).sort()).toStrictEqual(rows.map((row) => row.uid).sort());
    expect(stored.every((tag) => tag.status === "stock" && tag.profile_id === null)).toBe(true);
  });

  it("criterion 6: run twice → two distinct batches, each with its own count tags", async () => {
    const first = provision({ count: "2", site_url: SITE_URL, out: outFile("lot-b1.csv") });
    const second = provision({ count: "2", site_url: SITE_URL, out: outFile("lot-b2.csv") });

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    const [firstBatch] = batchIdsIn(first.stdout);
    const [secondBatch] = batchIdsIn(second.stdout);
    expect(firstBatch).toBeDefined();
    expect(secondBatch).toBeDefined();
    expect(secondBatch).not.toBe(firstBatch);
    expect(await tagsOfBatch(admin, firstBatch ?? "")).toHaveLength(2);
    expect(await tagsOfBatch(admin, secondBatch ?? "")).toHaveLength(2);
    const uids = [...readCsv(outFile("lot-b1.csv")).rows, ...readCsv(outFile("lot-b2.csv")).rows].map((row) => row.uid);
    expect(new Set(uids).size).toBe(4);
  });

  it("the activation codes appear in the file only, never on the standard or error output", () => {
    const out = outFile("lot-c.csv");

    const run = provision({ count: "2", site_url: SITE_URL, out });

    expect(run.status, run.stderr).toBe(0);
    for (const { activationCode } of readCsv(out).rows) {
      expect(run.stdout).not.toContain(activationCode);
      expect(run.stderr).not.toContain(activationCode);
    }
    expect(run.stdout).not.toMatch(CODE_ANYWHERE);
  });

  it("a code of the CSV activates the tag of its URL (the printed card works)", async () => {
    const out = outFile("lot-d.csv");
    const run = provision({ count: "1", site_url: SITE_URL, out });
    expect(run.status, run.stderr).toBe(0);
    const [row] = readCsv(out).rows;
    const member = await createMember(admin, (email) => {
      emails.push(email);
      return email;
    });

    const activate = makeActivateNfcTag({
      auth: makeSupabaseAuthGateway(member.session),
      membership: makeSupabaseMembershipReader(member.session),
      rateLimiter: makeSupabaseRateLimiter(admin, RUN_SECRET),
      tags: makeSupabaseNfcTagRepository(member.session),
    });

    expect(await activate({ uid: row?.uid ?? "", code: row?.activationCode ?? "", clientAddress: uniqueAddress() })).toStrictEqual(
      ok("activated"),
    );
  });

  it.each([
    ["count", { site_url: SITE_URL, out: "missing-count.csv" }],
    ["site_url", { count: "2", out: "missing-site-url.csv" }],
  ])("decision 9: missing %s → refused (non-zero exit), no tag created, no file written", async (_missing, variables) => {
    const before = await countTags(admin);
    const out = outFile(variables.out);

    const run = provision({ ...variables, out });

    expect(run.status).not.toBe(0);
    expect(existsSync(out)).toBe(false);
    expect(await countTags(admin)).toBe(before);
  });

  it("decision 9: missing out → refused (non-zero exit), no tag created", async () => {
    const before = await countTags(admin);

    const run = provision({ count: "2", site_url: SITE_URL });

    expect(run.status).not.toBe(0);
    expect(await countTags(admin)).toBe(before);
  });

  it.each(["0", "501", "abc", "-1"])("count=%s → refused (non-zero exit), no tag created", async (count) => {
    const before = await countTags(admin);

    const run = provision({ count, site_url: SITE_URL, out: outFile(`invalid-count-${count}.csv`) });

    expect(run.status).not.toBe(0);
    expect(await countTags(admin)).toBe(before);
  });

  describe("decision 13: hardening", () => {
    async function expectRefusedWithoutTag(variables: Record<string, string>): Promise<Run> {
      const before = await countTags(admin);

      const run = provision(variables);

      expect(run.status).not.toBe(0);
      expect(await countTags(admin)).toBe(before);
      expect(run.stdout).not.toMatch(CODE_ANYWHERE);
      expect(run.stderr).not.toMatch(CODE_ANYWHERE);
      return run;
    }

    it("empty out (-v out=) → refused, no tag, no code printed", async () => {
      await expectRefusedWithoutTag({ count: "2", site_url: SITE_URL, out: "" });
    });

    it("out starting with | (shell pipe) → refused, no tag, the command never runs", async () => {
      const witness = outFile("piped-witness");

      await expectRefusedWithoutTag({ count: "2", site_url: SITE_URL, out: `|touch ${witness}` });

      expect(existsSync(witness)).toBe(false);
    });

    it.each([
      ["http://", "http://carnet.example"],
      ["with a path", "https://carnet.example/chemin"],
      ["with a query", "https://carnet.example?x=1"],
      ["malformed", "pas une url"],
      ["without host", "https://"],
      ["with credentials", "https://user@carnet.example"],
      ["with a quote", "https://carnet.example'"],
    ])("site_url %s → refused, no tag, no file", async (_label, siteUrl) => {
      const out = outFile(`bad-site-${Buffer.from(siteUrl).toString("hex")}.csv`);

      await expectRefusedWithoutTag({ count: "2", site_url: siteUrl, out });

      expect(existsSync(out)).toBe(false);
    });

    it.each([
      ["a trailing slash", "https://carnet.example/", "https://carnet.example"],
      ["a port", "https://localhost:8443", "https://localhost:8443"],
    ])("site_url with %s is accepted, URLs without double slash", async (_label, siteUrl, origin) => {
      const out = outFile(`good-site-${Buffer.from(siteUrl).toString("hex")}.csv`);

      const run = provision({ count: "1", site_url: siteUrl, out });

      expect(run.status, run.stderr).toBe(0);
      const [line] = readFileSync(out, "utf8").trim().split(/\r?\n/).slice(1);
      expect(line).toMatch(new RegExp(`^${origin.replace(/[.]/g, "\\.")}/t/[0-9a-hjkmnp-tv-z]{12},`));
    });

    it("the CSV cannot be written (missing directory) → non-zero exit, no tag of the batch kept (transaction)", async () => {
      const before = await countTags(admin);

      const run = provision({ count: "3", site_url: SITE_URL, out: outFile("absent/lot.csv") });

      expect(run.status).not.toBe(0);
      expect(await countTags(admin)).toBe(before);
      for (const batchId of batchIdsIn(run.stdout)) {
        expect(await tagsOfBatch(admin, batchId)).toStrictEqual([]);
      }
      expect(run.stdout).not.toMatch(CODE_ANYWHERE);
    });
  });
});

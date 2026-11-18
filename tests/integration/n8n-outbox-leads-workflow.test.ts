/**
 * 0033 — structure of the versioned n8n workflow that e-mails the owner of a profile for each `lead.created` event of
 * `carnet.outbox`, and of its notice. Pure file checks (no n8n instance, no SMTP); the e-mail builder (Code node) is
 * executed on malicious inputs. Lives in the integration project because the unit project includes `src/**` alone.
 *
 * Contract frozen by test-engineer (`n8n/workflows/carnet-outbox-leads.json`, n8n export format):
 * // - exactly 9 nodes, named:
 * //   "Every minute"    n8n-nodes-base.scheduleTrigger, one rule: field "minutes" with minutesInterval 1, or cron "* * * * *";
 * //   "Config"          n8n-nodes-base.set, exactly 3 string fields with neutral example values (reserved example domains):
 * //                     supabaseUrl (https URL), fromAddress (bare address), siteUrl (https URL);
 * //   "Claim outbox"    n8n-nodes-base.httpRequest, POST {{ $('Config').first().json.supabaseUrl }}/rest/v1/rpc/claim_outbox,
 * //                     header Content-Profile: carnet, body { "p_limit": 20 };
 * //   "Has events"      n8n-nodes-base.if on a non-empty `id`, true output (0) → "Build email", false output (1)
 * //                     connected to nothing (an empty batch ends the run);
 * //   "Build email"     n8n-nodes-base.code, mode "runOnceForEachItem"; input = one row of claim_outbox; reads
 * //                     fromAddress and siteUrl through $('Config'); returns { id, to, from, replyTo, subject, text, html }
 * //                     (see the "criterion 3" tests); text holds the event id ("Référence : <id>", traceability);
 * //                     no Message-ID (Hery, 18/11/2026: the Send Email node cannot set it);
 * //                     from = `"<cleaned lead_name> via AuraCard" <fromAddress>` in plain text, \ and " escaped, no
 * //                     RFC 2047 encoded word (left to nodemailer; review of 18/11/2026); no CR, LF, U+2028, U+2029 nor
 * //                     bidi control (U+202A–202E, U+2066–2069) in from / subject; text and html carry the warning
 * //                     "Expéditeur non vérifié : ne communiquez aucune information sensible";
 * //   "Send email"      n8n-nodes-base.emailSend, emailFormat "both", options.appendAttribution false, SMTP credential
 * //                     referenced by name (name contains "Infomaniak"), onError "continueErrorOutput";
 * //                     parameters read json.from / to / subject / text / html / replyTo;
 * //                     success output (0) → "Complete outbox"; error output (1) → "Fail outbox", never "Complete outbox";
 * //   "Complete outbox" httpRequest POST …/rest/v1/rpc/complete_outbox, Content-Profile: carnet, body with p_id;
 * //                     Complete / Fail outbox read p_id from "Build email" ($('Build email')…json.id), never $json.id;
 * //                     retryOnFail true on Complete / Fail outbox, never on Send email nor Claim outbox;
 * //   "Fail outbox"     httpRequest POST …/rest/v1/rpc/fail_outbox, Content-Profile: carnet, body with p_id and p_error =
 * //                     a literal normalized code ([a-z][a-z0-9_]*), never the error of the SMTP node;
 * //   "Next batch"      collapses a batch to one item (n8n-nodes-base.limit maxItems 1, n8n-nodes-base.aggregate, or a
 * //                     Code node in "runOnceForAllItems"), then → "Claim outbox" (loop until an empty batch);
 * // - the three HTTP nodes authenticate with the n8n credential "carnet Supabase service_role" (supabaseApi);
 * // - no `$env`, no secret, no pinned data; settings.saveDataSuccessExecution "none".
 * Notice `n8n/workflows/carnet-outbox-leads.md`: import, credentials, SPF / DKIM / DMARC, execution retention
 * ("conservation des exécutions" + EXECUTIONS_DATA_PRUNE / EXECUTIONS_DATA_MAX_AGE or saveDataErrorExecution),
 * request on `dead` events, manual test with several messages and a check of the raw From header, GDPR sentence
 * ("sous-traitant").
 */
import { describe, expect, it } from "vitest";

import { aClaimedLeadEvent, OUTBOX_EVENT_IDS } from "../builders/outbox-event";
import {
  findNode,
  n8nFileExists,
  parseWorkflow,
  escapeRegExp,
  RESERVED_EXAMPLE_HOST,
  reachable,
  readN8nFile,
  runCodeNodeForItem,
  setNodeFields,
  targetsOf,
  urlReadsConfig,
  type N8nNode,
  type N8nWorkflow,
} from "./support/n8n-workflow";

const WORKFLOW_FILE = "carnet-outbox-leads.json";
const NOTICE_FILE = "carnet-outbox-leads.md";

const NODE_NAMES = [
  "Every minute",
  "Config",
  "Claim outbox",
  "Has events",
  "Build email",
  "Send email",
  "Complete outbox",
  "Fail outbox",
  "Next batch",
] as const;

const RPC_NODES = ["Claim outbox", "Complete outbox", "Fail outbox"] as const;

const SUPABASE_CREDENTIAL = "carnet Supabase service_role";

/** Config seen by the Code node in these tests: different from the example values, so hard-coding is detected. */
const TEST_CONFIG = {
  supabaseUrl: "https://db.test.example",
  fromAddress: "notifications@mail.test.example",
  siteUrl: "https://cartes.test.example",
} as const;

function raw(): string {
  return readN8nFile(WORKFLOW_FILE);
}

function workflow(): N8nWorkflow {
  return parseWorkflow(raw());
}

function node(name: string): N8nNode {
  return findNode(workflow(), name);
}

function parametersOf(name: string): string {
  return JSON.stringify(node(name).parameters ?? {});
}

function methodOf(name: string): string {
  const method = node(name).parameters?.method;
  return typeof method === "string" ? method.toUpperCase() : "GET";
}

function urlOf(name: string): string {
  const url = node(name).parameters?.url;
  if (typeof url !== "string") {
    throw new Error(`node "${name}" has no url`);
  }
  return url.replace(/\s+/g, "");
}

function bodyOf(name: string): string {
  const body = node(name).parameters?.jsonBody;
  if (typeof body !== "string") {
    throw new Error(`node "${name}" has no jsonBody`);
  }
  return body;
}

async function buildEmail(overrides: Parameters<typeof aClaimedLeadEvent>[0] = {}): Promise<Record<string, unknown>> {
  const code = node("Build email").parameters?.jsCode;
  if (typeof code !== "string") {
    throw new Error('node "Build email" has no jsCode');
  }
  const row = aClaimedLeadEvent(overrides);
  return runCodeNodeForItem(code, row, { Config: TEST_CONFIG, "Claim outbox": row, "Has events": row });
}

function text(value: unknown): string {
  expect(typeof value).toBe("string");
  return value as string;
}

const DISPLAY_SUFFIX = " via AuraCard";

/**
 * Parses `"<name> via AuraCard" <address>`: a quoted string where `\` and `"` only appear escaped (`\\`, `\"`); an
 * unescaped `"` in the name breaks the match. Returns the unescaped name, without the suffix.
 */
function displayName(from: string, address: string): string {
  expect(from).not.toMatch(/=\?UTF-8\?/i);
  const match = new RegExp(`^"((?:[^"\\\\]|\\\\.)*)" <${escapeRegExp(address)}>$`).exec(from);
  if (match === null) {
    throw new Error(`From is not "<name>${DISPLAY_SUFFIX}" <${address}>: ${JSON.stringify(from)}`);
  }
  const quoted = (match[1] ?? "").replace(/\\(.)/g, "$1");
  if (!quoted.endsWith(DISPLAY_SUFFIX)) {
    throw new Error(`From display name does not end with "${DISPLAY_SUFFIX}": ${JSON.stringify(quoted)}`);
  }
  return quoted.slice(0, -DISPLAY_SUFFIX.length);
}

/** Characters that must never reach a header: CR, LF, line / paragraph separators, bidi controls. */
const HEADER_BREAKERS = /[\r\n\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

const UNVERIFIED_SENDER_WARNING = "Expéditeur non vérifié : ne communiquez aucune information sensible";

const HEADER_FIELDS = ["to", "from", "replyTo", "subject"] as const;

const MALICIOUS_NAMES = [
  "Eve\r\nBcc: victim@evil.example",
  "<script>alert(1)</script>",
  'Eve "the boss" <eve@evil.example>',
  "a@x.example, b@y.example",
  "Eve\u2028Bcc: x@evil.example",
  "Eve\u2029Bcc: x@evil.example",
  "\u202Eevil\u202C \u202A\u202B\u202D\u2066\u2067\u2068x\u2069",
  "Back\\slash \\\" quote",
] as const;

describe("n8n workflow carnet-outbox-leads (0033)", () => {
  describe("structure", () => {
    it("is a valid JSON workflow with exactly the 9 named nodes", () => {
      expect(n8nFileExists(WORKFLOW_FILE)).toBe(true);
      const parsed = workflow();

      expect(Array.isArray(parsed.nodes)).toBe(true);
      expect(typeof parsed.connections).toBe("object");
      expect(parsed.nodes.map((candidate) => candidate.name).sort()).toStrictEqual([...NODE_NAMES].sort());
    });

    it("decision 3: a Config node holds supabaseUrl, fromAddress and siteUrl with neutral example values", () => {
      const config = node("Config");
      expect(config.type).toBe("n8n-nodes-base.set");

      const fields = Object.fromEntries(setNodeFields(config).map(({ name, value }) => [name, value]));
      expect(Object.keys(fields).sort()).toStrictEqual(["fromAddress", "siteUrl", "supabaseUrl"]);
      for (const field of ["supabaseUrl", "siteUrl"]) {
        const url = new URL(text(fields[field]));
        expect(url.protocol).toBe("https:");
        expect(url.hostname).toMatch(RESERVED_EXAMPLE_HOST);
      }
      const fromAddress = text(fields.fromAddress);
      expect(fromAddress).toMatch(/^[^@\s<>"]+@[^@\s<>"]+$/);
      expect(fromAddress.split("@")[1]).toMatch(RESERVED_EXAMPLE_HOST);
    });
  });

  describe("criterion 1: no secret, no $env, credentials referenced by name", () => {
    it("criterion 1: contains no $env expression", () => {
      expect(raw()).not.toMatch(/\$env\b/);
    });

    it("criterion 1: the three PostgREST calls authenticate with the credential « carnet Supabase service_role »", () => {
      for (const name of RPC_NODES) {
        const http = node(name);
        expect(http.type).toBe("n8n-nodes-base.httpRequest");
        expect(http.parameters?.authentication).toBe("predefinedCredentialType");
        expect(http.parameters?.nodeCredentialType).toBe("supabaseApi");
        expect(http.credentials?.supabaseApi?.name).toBe(SUPABASE_CREDENTIAL);
      }
    });

    it("criterion 1: the e-mail is sent with an Infomaniak SMTP credential referenced by name", () => {
      const send = node("Send email");
      expect(send.type).toBe("n8n-nodes-base.emailSend");
      const smtp = send.credentials?.smtp;
      expect(typeof smtp?.name).toBe("string");
      expect(smtp?.name).toMatch(/infomaniak/i);
    });

    it("criterion 1: contains no secret (no JWT, key, auth header, password, SMTP host, real address, pinned data)", () => {
      const content = raw();

      expect(content).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
      expect(content).not.toMatch(/sb_(secret|publishable)_/);
      expect(content).not.toMatch(/\bBearer\s+[A-Za-z0-9._-]{16,}/);
      expect(content).not.toMatch(/"(password|pass|user|host)"\s*:/i);
      expect(content).not.toMatch(/infomaniak\.(com|ch)/i);
      for (const candidate of workflow().nodes) {
        expect(JSON.stringify(candidate.parameters ?? {})).not.toMatch(/"name"\s*:\s*"(apikey|authorization)"/i);
      }
      for (const [, domain] of content.matchAll(/[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g)) {
        expect(domain).toMatch(RESERVED_EXAMPLE_HOST);
      }
      expect(Object.keys(workflow().pinData ?? {})).toStrictEqual([]);
    });
  });

  describe("criterion 2: claims, sends, then acknowledges; a send error calls fail_outbox", () => {
    it("decision 1: is triggered every minute", () => {
      const trigger = node("Every minute");
      expect(trigger.type).toBe("n8n-nodes-base.scheduleTrigger");

      const rule = trigger.parameters?.rule as { interval?: Array<Record<string, unknown>> } | undefined;
      const intervals = rule?.interval ?? [];
      expect(intervals).toHaveLength(1);
      const [interval] = intervals;
      const everyMinute =
        (interval?.field === "minutes" && interval.minutesInterval === 1) ||
        (interval?.field === "cronExpression" &&
          typeof interval.expression === "string" &&
          /^(\*|\*\/1) \* \* \* \*$/.test(interval.expression.trim()));
      expect(everyMinute).toBe(true);
    });

    it("decision 1: calls carnet.claim_outbox with p_limit = 20 through PostgREST", () => {
      expect(methodOf("Claim outbox")).toBe("POST");
      expect(urlOf("Claim outbox")).toMatch(/\/rest\/v1\/rpc\/claim_outbox$/);
      expect(parametersOf("Claim outbox")).toContain("Content-Profile");
      expect(parametersOf("Claim outbox")).toContain("carnet");
      expect(bodyOf("Claim outbox")).toMatch(/p_limit\\?["']?\s*:\s*20\b/);
    });

    it("decision 2: complete_outbox and fail_outbox are called with p_id through PostgREST", () => {
      for (const [name, rpc] of [
        ["Complete outbox", "complete_outbox"],
        ["Fail outbox", "fail_outbox"],
      ] as const) {
        expect(methodOf(name)).toBe("POST");
        expect(urlOf(name)).toMatch(new RegExp(`/rest/v1/rpc/${rpc}$`));
        expect(parametersOf(name)).toContain("Content-Profile");
        expect(parametersOf(name)).toContain("carnet");
        expect(bodyOf(name)).toMatch(/p_id/);
        expect(bodyOf(name)).toMatch(/\bid\b/);
      }
    });

    it("review 0033: complete_outbox and fail_outbox read p_id from Build email, never from $json", () => {
      for (const name of ["Complete outbox", "Fail outbox"]) {
        const body = bodyOf(name);
        expect(body).toMatch(/(\$\(['"]Build email['"]\)\.(item|first\(\))|\$node\[['"]Build email['"]\])\.json\.id\b/);
        expect(body).not.toMatch(/\$json\.id\b/);
      }
    });

    it("decision 3: every PostgREST URL is built from supabaseUrl of Config (no $json: Claim outbox is also reached from the loop)", () => {
      for (const name of RPC_NODES) {
        expect(urlReadsConfig(urlOf(name), "supabaseUrl")).toBe(true);
      }
    });

    it("criterion 2: path Every minute → Config → Claim outbox → Has events → Build email → Send email", () => {
      const parsed = workflow();
      expect(targetsOf(parsed, "Every minute", 0)).toStrictEqual(["Config"]);
      expect(targetsOf(parsed, "Config", 0)).toStrictEqual(["Claim outbox"]);
      expect(targetsOf(parsed, "Claim outbox", 0)).toStrictEqual(["Has events"]);
      expect(node("Has events").type).toBe("n8n-nodes-base.if");
      expect(targetsOf(parsed, "Has events", 0)).toStrictEqual(["Build email"]);
      expect(reachable(parsed, "Build email", "Send email")).toBe(true);
      expect(reachable(parsed, "Build email", "Complete outbox")).toBe(true);
    });

    it("review 0033: Has events lets through a non-empty id only; its false output is connected to nothing", () => {
      expect(targetsOf(workflow(), "Has events", 1)).toStrictEqual([]);
      const conditions =
        (node("Has events").parameters?.conditions as
          | { conditions?: Array<{ leftValue?: unknown; operator?: { operation?: unknown } }> }
          | undefined)?.conditions ?? [];
      const onNonEmptyId = conditions.some(
        (condition) =>
          typeof condition.leftValue === "string" &&
          /\.id\b/.test(condition.leftValue) &&
          condition.operator?.operation === "notEmpty",
      );
      expect(onNonEmptyId).toBe(true);
    });

    it("review 0033: no retry on Send email (duplicates) nor Claim outbox (claims), retries on the acknowledgements", () => {
      expect(node("Send email")).not.toHaveProperty("retryOnFail", true);
      expect(node("Claim outbox")).not.toHaveProperty("retryOnFail", true);
      expect(node("Complete outbox")).toHaveProperty("retryOnFail", true);
      expect(node("Fail outbox")).toHaveProperty("retryOnFail", true);
    });

    it("criterion 2: a sent e-mail is acknowledged by complete_outbox, a send error by fail_outbox only", () => {
      const parsed = workflow();
      expect(node("Send email").onError).toBe("continueErrorOutput");
      expect(targetsOf(parsed, "Send email", 0)).toStrictEqual(["Complete outbox"]);
      expect(targetsOf(parsed, "Send email", 1)).toStrictEqual(["Fail outbox"]);
      expect(reachable(parsed, "Complete outbox", "Send email")).toBe(true);
    });

    it("decision 6: fail_outbox receives a normalized error code, never the body of the SMTP error", () => {
      const body = bodyOf("Fail outbox");

      expect(body).toMatch(/p_error\\?["']?\s*:\s*\\?["'][a-z][a-z0-9_]*\\?["']/);
      expect(body).not.toMatch(/\$json\.error|\.error\b|\.message\b|\.description\b|\.cause\b|\.response\b/);
    });

    it("decision 6: claim_outbox is called again after each batch until an empty batch (one call per batch)", () => {
      const parsed = workflow();
      const next = node("Next batch");

      expect(reachable(parsed, "Complete outbox", "Next batch")).toBe(true);
      expect(reachable(parsed, "Fail outbox", "Next batch")).toBe(true);
      expect(targetsOf(parsed, "Next batch", 0)).toStrictEqual(["Claim outbox"]);
      expect(reachable(parsed, "Claim outbox", "Claim outbox")).toBe(true);
      const collapsesToOneItem =
        (next.type === "n8n-nodes-base.limit" && next.parameters?.maxItems === 1) ||
        next.type === "n8n-nodes-base.aggregate" ||
        (next.type === "n8n-nodes-base.code" && next.parameters?.mode === "runOnceForAllItems");
      expect(collapsesToOneItem).toBe(true);
    });

    it("decision 6: execution data of successful runs is not kept (lead data must not outlive 12 months)", () => {
      expect(workflow().settings?.saveDataSuccessExecution).toBe("none");
      expect(workflow().settings?.saveExecutionProgress).not.toBe(true);
    });
  });

  describe("criterion 3: the visitor's content cannot inject a header or HTML", () => {
    it("decision 2: Build email is a Code node run once for each item", () => {
      expect(node("Build email").type).toBe("n8n-nodes-base.code");
      expect(node("Build email").parameters?.mode).toBe("runOnceForEachItem");
    });

    it("decision 2: Send email sends text + HTML built by Build email, without n8n attribution", () => {
      const send = node("Send email");
      const parameters = parametersOf("Send email");

      expect(send.parameters?.emailFormat).toBe("both");
      expect((send.parameters?.options as Record<string, unknown> | undefined)?.appendAttribution).toBe(false);
      for (const field of ["from", "to", "subject", "text", "html", "replyTo"]) {
        expect(parameters).toMatch(new RegExp(`json\\.${field}\\b`));
      }
    });

    it("decision 2: the e-mail goes to the owner, from the Config address, with a link to /tableau-de-bord/messages", async () => {
      const email = await buildEmail();

      expect(email.id).toBe(OUTBOX_EVENT_IDS[0]);
      expect(email.to).toBe("elodie.durand@owner.example");
      expect(displayName(text(email.from), TEST_CONFIG.fromAddress)).toBe("Jeanne Martin");
      expect(text(email.subject).length).toBeGreaterThan(0);
      expect(text(email.text)).toContain("je souhaite un devis.");
      expect(text(email.text)).toContain("https://cartes.test.example/tableau-de-bord/messages");
      expect(text(email.html)).toContain("je souhaite un devis.");
      expect(text(email.html)).toContain("https://cartes.test.example/tableau-de-bord/messages");
    });

    it("decision 6: Reply-To is lead_email alone", async () => {
      const email = await buildEmail();

      expect(email.replyTo).toBe("jeanne.martin@client.example");
    });

    it.each([
      ["a list", "a@x.example, b@y.example"],
      ["a display name", '"Eve" <eve@evil.example>'],
      ["a CRLF header", "eve@evil.example\r\nBcc: victim@evil.example"],
      ["a semicolon list", "a@x.example;b@y.example"],
      ["a U+2028 header", "eve@evil.example\u2028Bcc: x@evil.example"],
      ["a U+2029 header", "eve@evil.example\u2029Bcc: x@evil.example"],
    ])("decision 6: a lead_email holding %s gives no Reply-To", async (_label, leadEmail) => {
      const email = await buildEmail({ lead_email: leadEmail });

      expect(email.replyTo).toBe("");
    });

    it("review 0033: the display name is plain UTF-8 in quotes, the RFC 2047 encoding is left to nodemailer", async () => {
      const email = await buildEmail({ lead_name: "Élodie Ünal-Ørsted" });

      expect(text(email.from)).toBe(`"Élodie Ünal-Ørsted via AuraCard" <${TEST_CONFIG.fromAddress}>`);
      expect(displayName(text(email.from), TEST_CONFIG.fromAddress)).toBe("Élodie Ünal-Ørsted");
    });

    it('review 0033: \\ and " of the name are escaped in the quoted display name', async () => {
      const email = await buildEmail({ lead_name: 'Eve "the boss" \\ admin' });

      expect(text(email.from)).toBe(`"Eve \\"the boss\\" \\\\ admin via AuraCard" <${TEST_CONFIG.fromAddress}>`);
      expect(displayName(text(email.from), TEST_CONFIG.fromAddress)).toBe('Eve "the boss" \\ admin');
    });

    it.each(MALICIOUS_NAMES)("criterion 3: lead_name %j cannot inject a header", async (leadName) => {
      const email = await buildEmail({ lead_name: leadName });

      for (const field of HEADER_FIELDS) {
        expect(text(email[field])).not.toMatch(HEADER_BREAKERS);
      }
      expect(email.to).toBe("elodie.durand@owner.example");
      expect(email.replyTo).toBe("jeanne.martin@client.example");
      expect(displayName(text(email.from), TEST_CONFIG.fromAddress)).not.toMatch(HEADER_BREAKERS);
    });

    it("criterion 3: a CRLF in lead_message or owner_display_name reaches no header", async () => {
      const email = await buildEmail({
        lead_message: "Bonjour\r\nBcc: victim@evil.example\r\n\r\n<b>corps</b>",
        owner_display_name: "Owner\r\nX-Injected: 1",
      });

      for (const field of HEADER_FIELDS) {
        expect(text(email[field])).not.toMatch(/[\r\n]/);
        expect(text(email[field])).not.toContain("victim@evil.example");
      }
    });

    it("decision 6: lead_name and lead_message are HTML-escaped", async () => {
      const email = await buildEmail({
        lead_name: '<script>alert("name")</script>',
        lead_message: '<img src=x onerror=alert(1)>\n<script>alert(2)</script>\n"quoted" & \'single\'',
        owner_display_name: "<i>Owner</i>",
      });
      const html = text(email.html);

      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toContain("<i>Owner");
      expect(html).not.toContain('"quoted"');
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).toMatch(/&quot;quoted&quot;|&#34;quoted&#34;/);
      expect(html).toContain("&amp;");
    });

    it("audit 0033: text and html warn that the sender is not verified", async () => {
      const email = await buildEmail();

      expect(text(email.text)).toContain(UNVERIFIED_SENDER_WARNING);
      expect(text(email.html)).toContain(UNVERIFIED_SENDER_WARNING);
    });

    it("traceability (Hery, 18/11/2026, replaces the Message-ID): the id of the event appears in the text", async () => {
      const first = await buildEmail({ id: OUTBOX_EVENT_IDS[0] });
      const second = await buildEmail({ id: OUTBOX_EVENT_IDS[1] });

      expect(text(first.text)).toContain(`Référence : ${OUTBOX_EVENT_IDS[0]}`);
      expect(text(second.text)).toContain(`Référence : ${OUTBOX_EVENT_IDS[1]}`);
      expect(first).not.toHaveProperty("messageId");
    });

    it("idempotence: building the e-mail of the same event twice gives the same e-mail", async () => {
      const first = await buildEmail();
      const second = await buildEmail();

      expect(second).toStrictEqual(first);
    });
  });

  describe("criterion 4: the notice", () => {
    function notice(): string {
      return readN8nFile(NOTICE_FILE);
    }

    it("criterion 4: the notice exists next to the workflow", () => {
      expect(n8nFileExists(NOTICE_FILE)).toBe(true);
    });

    it("criterion 4: describes the import and both credentials", () => {
      const content = notice();

      expect(content).toMatch(/import/i);
      expect(content).toContain(WORKFLOW_FILE);
      expect(content).toContain(SUPABASE_CREDENTIAL);
      expect(content).toMatch(/SMTP/);
      expect(content).toMatch(/Infomaniak/);
    });

    it("criterion 4: describes the sending domain (SPF, DKIM, DMARC)", () => {
      const content = notice();

      for (const record of ["SPF", "DKIM", "DMARC"]) {
        expect(content).toContain(record);
      }
    });

    it("decision 6: describes how execution retention is disabled or purged", () => {
      const content = notice();

      expect(content).toMatch(/conservation des exécutions/i);
      expect(content).toMatch(/EXECUTIONS_DATA_(PRUNE|MAX_AGE)|saveDataErrorExecution/);
    });

    it("decision 5: documents the request listing dead events", () => {
      const content = notice();

      expect(content).toMatch(/select[\s\S]*carnet\.outbox[\s\S]*'dead'/i);
    });

    it("criterion 4: describes the manual test", () => {
      expect(notice()).toMatch(/test manuel/i);
    });

    it("review 0033: the manual test sends several messages and checks the raw From header", () => {
      const content = notice();

      expect(content).toMatch(/(\b[2-9]\b|plusieurs|deux|trois)[^.\n]{0,40}messages/i);
      expect(content).toMatch(/From/);
      expect(content).toMatch(/\bbrut/i);
    });

    it("audit 0033: the GDPR sentence names the processors", () => {
      expect(notice()).toMatch(/sous-traitant/i);
    });
  });
});

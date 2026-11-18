/**
 * 0027 — criterion 4 (and decision 1): structure of the versioned n8n workflow that purges the orphan media.
 * Pure file check (no n8n instance); it lives in the integration project only because the unit project includes
 * `src/**` alone.
 *
 * Contract frozen by test-engineer (`n8n/workflows/carnet-media-purge.json`, n8n export format):
 * // - valid JSON object with `nodes` (array) and `connections` (object, n8n format: connections[source].main[i][] = { node });
 * // - exactly 5 nodes;
 * // - node "Daily schedule"      n8n-nodes-base.scheduleTrigger: one rule, every day (field "days", interval 1) or a
 * //                              cron expression "<minute> <hour> * * *";
 * // - node "Config"              n8n-nodes-base.set ("Edit Fields"): exactly one string field, the public URL of
 * //                              Supabase, with a neutral example value (https, host under a reserved example domain:
 * //                              *.example, example.com|org|net); decision of Hery (0027, report 2);
 * // - <supabase> = n8n expression reading the field of "Config": {{ $('Config').item.json.<field> }} (or
 * //   .first().json / $node["Config"].json; "List orphan media", directly after "Config", may use $json.<field>);
 * // - no `$env` anywhere in the workflow;
 * // - node "List orphan media"   n8n-nodes-base.httpRequest, POST <supabase>/rest/v1/rpc/list_orphan_media, header
 * //                              Content-Profile: carnet, body { "p_older_than": "24 hours" };
 * // - node "Batch by 100"        n8n-nodes-base.splitInBatches (batchSize 100) or n8n-nodes-base.code chunking by 100;
 * // - node "Delete orphan media" n8n-nodes-base.httpRequest, DELETE <supabase>/storage/v1/object/carnet-media,
 * //                              body { "prefixes": [<up to 100 names>] } (an absent object is a success: replayable);
 * // - path Daily schedule → Config → List orphan media → Batch by 100 → … → Delete orphan media in `connections`;
 * // - both HTTP nodes authenticate through an n8n credential referenced by name (authentication
 * //   "predefinedCredentialType" or "genericCredentialType", `credentials` set): no apikey / Authorization header
 * //   written in the workflow, no JWT, no Supabase key, no pinned data; no other bucket than carnet-media.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../n8n/workflows/carnet-media-purge.json",
);

type N8nNode = {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, { id?: string; name?: string }>;
};

type N8nConnections = Record<string, { main?: Array<Array<{ node: string }> | null> }>;

type N8nWorkflow = { nodes: N8nNode[]; connections: N8nConnections; pinData?: Record<string, unknown> };

function rawWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

function workflow(): N8nWorkflow {
  const parsed: unknown = JSON.parse(rawWorkflow());
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("the workflow is not a JSON object");
  }
  return parsed as N8nWorkflow;
}

function node(name: string): N8nNode {
  const found = workflow().nodes.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`node "${name}" missing from the workflow`);
  }
  return found;
}

function parametersOf(name: string): string {
  return JSON.stringify(node(name).parameters ?? {});
}

function reachable(from: string, to: string): boolean {
  const { connections } = workflow();
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const output of connections[current]?.main ?? []) {
      for (const target of output ?? []) {
        if (target.node === to) return true;
        queue.push(target.node);
      }
    }
  }
  return false;
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

const RESERVED_EXAMPLE_HOST = /(^|\.)example$|(^|\.)example\.(com|org|net)$/;

/** Fields of a Set node: `assignments` (typeVersion ≥ 3.3) or `fields.values` (3.0 to 3.2). */
function configFields(): Array<{ name: string; value: unknown }> {
  const parameters = node("Config").parameters ?? {};
  const assignments = (parameters.assignments as { assignments?: Array<{ name: string; value: unknown; type?: string }> } | undefined)
    ?.assignments;
  if (assignments !== undefined) {
    return assignments.map(({ name, value }) => ({ name, value }));
  }
  const values = (parameters.fields as { values?: Array<{ name: string; stringValue?: unknown }> } | undefined)?.values;
  return (values ?? []).map(({ name, stringValue }) => ({ name, value: stringValue }));
}

function configFieldName(): string {
  const [field] = configFields();
  if (field === undefined) {
    throw new Error('node "Config" has no field');
  }
  return field.name;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readsConfig(url: string, allowJson: boolean): boolean {
  const field = escaped(configFieldName());
  const sources = [
    `\\$\\(['"]Config['"]\\)\\.(item|first\\(\\))\\.json`,
    `\\$node\\[['"]Config['"]\\]\\.json`,
    ...(allowJson ? ["\\$json"] : []),
  ];
  return new RegExp(`^=\\{\\{(${sources.join("|")})\\.${field}\\}\\}/`).test(url);
}

describe("n8n workflow carnet-media-purge (0027)", () => {
  it("is a valid JSON workflow with exactly 5 nodes and connections", () => {
    const parsed = workflow();

    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(typeof parsed.connections).toBe("object");
    expect(parsed.nodes.map((candidate) => candidate.name).sort()).toStrictEqual(
      ["Batch by 100", "Config", "Daily schedule", "Delete orphan media", "List orphan media"].sort(),
    );
  });

  it("decision of Hery (report 2): a Config node holds the public URL of Supabase in a single field, neutral example value", () => {
    const config = node("Config");
    expect(config.type).toBe("n8n-nodes-base.set");

    const fields = configFields();
    expect(fields).toHaveLength(1);
    const [field] = fields;
    expect(typeof field?.value).toBe("string");
    const url = new URL(String(field?.value));
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toMatch(RESERVED_EXAMPLE_HOST);
  });

  it("decision of Hery (report 2): both HTTP URLs are built from the field of Config", () => {
    expect(readsConfig(urlOf("List orphan media"), true)).toBe(true);
    expect(readsConfig(urlOf("Delete orphan media"), false)).toBe(true);
  });

  it("decision of Hery (report 2): no $env expression anywhere", () => {
    expect(rawWorkflow()).not.toMatch(/\$env\b/);
  });

  it("decision 1: is triggered by a daily schedule", () => {
    const trigger = node("Daily schedule");
    expect(trigger.type).toBe("n8n-nodes-base.scheduleTrigger");

    const rule = trigger.parameters?.rule as { interval?: Array<Record<string, unknown>> } | undefined;
    const intervals = rule?.interval ?? [];
    expect(intervals).toHaveLength(1);
    const [interval] = intervals;
    const daily =
      (interval?.field === "days" && (interval.daysInterval === undefined || interval.daysInterval === 1)) ||
      (interval?.field === "cronExpression" &&
        typeof interval.expression === "string" &&
        /^\d{1,2} \d{1,2} \* \* \*$/.test(interval.expression.trim()));
    expect(daily).toBe(true);
  });

  it("criterion 4: calls carnet.list_orphan_media with 24 hours through PostgREST", () => {
    const list = node("List orphan media");

    expect(list.type).toBe("n8n-nodes-base.httpRequest");
    expect(methodOf("List orphan media")).toBe("POST");
    expect(urlOf("List orphan media")).toMatch(/\/rest\/v1\/rpc\/list_orphan_media$/);
    const parameters = parametersOf("List orphan media");
    expect(parameters).toContain("Content-Profile");
    expect(parameters).toContain("carnet");
    expect(parameters).toContain("p_older_than");
    expect(parameters).toContain("24 hours");
  });

  it("criterion 4: groups the names by batches of 100", () => {
    const batch = node("Batch by 100");

    expect(["n8n-nodes-base.splitInBatches", "n8n-nodes-base.code"]).toContain(batch.type);
    if (batch.type === "n8n-nodes-base.splitInBatches") {
      expect(batch.parameters?.batchSize).toBe(100);
    } else {
      expect(String(batch.parameters?.jsCode ?? "")).toMatch(/\b100\b/);
    }
  });

  it("criteria 4 and 5: deletes through the Storage API of the carnet-media bucket (absent object = success)", () => {
    const remove = node("Delete orphan media");

    expect(remove.type).toBe("n8n-nodes-base.httpRequest");
    expect(methodOf("Delete orphan media")).toBe("DELETE");
    expect(urlOf("Delete orphan media")).toMatch(/\/storage\/v1\/object\/carnet-media$/);
    expect(parametersOf("Delete orphan media")).toContain("prefixes");
  });

  it("criterion 4: calls the function, then deletes (schedule → config → list → batch → delete)", () => {
    expect(reachable("Daily schedule", "Config")).toBe(true);
    expect(reachable("Config", "List orphan media")).toBe(true);
    expect(reachable("Daily schedule", "List orphan media")).toBe(true);
    expect(reachable("List orphan media", "Batch by 100")).toBe(true);
    expect(reachable("Batch by 100", "Delete orphan media")).toBe(true);
    expect(reachable("Delete orphan media", "List orphan media")).toBe(false);
  });

  it("decision 1: never touches another bucket", () => {
    const buckets = [...rawWorkflow().matchAll(/\/storage\/v1\/object\/([^/"\s?]+)/g)].map((match) => match[1]);

    expect(buckets.length).toBeGreaterThan(0);
    expect(new Set(buckets)).toStrictEqual(new Set(["carnet-media"]));
  });

  it("criterion 4: both HTTP calls authenticate through an n8n credential referenced by name", () => {
    for (const name of ["List orphan media", "Delete orphan media"]) {
      const http = node(name);
      expect(["predefinedCredentialType", "genericCredentialType"]).toContain(http.parameters?.authentication);
      const credentials = Object.values(http.credentials ?? {});
      expect(credentials.length).toBeGreaterThan(0);
      for (const credential of credentials) {
        expect(typeof credential.name).toBe("string");
        expect(credential.name).not.toBe("");
      }
    }
  });

  it("criterion 4: contains no secret (no JWT, no Supabase key, no auth header, no pinned data)", () => {
    const raw = rawWorkflow();

    expect(raw).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
    expect(raw).not.toMatch(/sb_(secret|publishable)_/);
    expect(raw).not.toMatch(/\bBearer\s+[A-Za-z0-9._-]{16,}/);
    for (const candidate of workflow().nodes) {
      expect(JSON.stringify(candidate.parameters ?? {})).not.toMatch(/"name"\s*:\s*"(apikey|authorization)"/i);
    }
    expect(Object.keys(workflow().pinData ?? {})).toStrictEqual([]);
  });
});

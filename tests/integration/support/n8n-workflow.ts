import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Read-only helpers over a versioned n8n export (`n8n/workflows/*.json`); no n8n instance involved. */

export type N8nNode = {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, { id?: string; name?: string }>;
  onError?: string;
};

export type N8nConnections = Record<string, { main?: Array<Array<{ node: string }> | null> }>;

export type N8nWorkflow = {
  nodes: N8nNode[];
  connections: N8nConnections;
  pinData?: Record<string, unknown>;
  settings?: Record<string, unknown>;
};

const N8N_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../n8n/workflows");

export function n8nFilePath(fileName: string): string {
  return path.join(N8N_DIR, fileName);
}

export function n8nFileExists(fileName: string): boolean {
  return existsSync(n8nFilePath(fileName));
}

export function readN8nFile(fileName: string): string {
  return readFileSync(n8nFilePath(fileName), "utf8");
}

export function parseWorkflow(raw: string): N8nWorkflow {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("the workflow is not a JSON object");
  }
  return parsed as N8nWorkflow;
}

export function findNode(workflow: N8nWorkflow, name: string): N8nNode {
  const found = workflow.nodes.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`node "${name}" missing from the workflow`);
  }
  return found;
}

/** Targets of one output (`main[index]`) of a node. */
export function targetsOf(workflow: N8nWorkflow, name: string, outputIndex: number): string[] {
  return (workflow.connections[name]?.main?.[outputIndex] ?? []).map((target) => target.node);
}

/** True when `to` can be reached from `from` by following at least one connection. */
export function reachable(workflow: N8nWorkflow, from: string, to: string, startOutputs?: number[]): boolean {
  const seen = new Set<string>();
  const queue: string[] = [];
  const outputs = workflow.connections[from]?.main ?? [];
  outputs.forEach((output, index) => {
    if (startOutputs === undefined || startOutputs.includes(index)) {
      for (const target of output ?? []) queue.push(target.node);
    }
  });
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const output of workflow.connections[current]?.main ?? []) {
      for (const target of output ?? []) queue.push(target.node);
    }
  }
  return false;
}

/** Fields of a Set node: `assignments` (typeVersion >= 3.3) or `fields.values` (3.0 to 3.2). */
export function setNodeFields(node: N8nNode): Array<{ name: string; value: unknown }> {
  const parameters = node.parameters ?? {};
  const assignments = (parameters.assignments as { assignments?: Array<{ name: string; value: unknown }> } | undefined)
    ?.assignments;
  if (assignments !== undefined) {
    return assignments.map(({ name, value }) => ({ name, value }));
  }
  const values = (parameters.fields as { values?: Array<{ name: string; stringValue?: unknown }> } | undefined)?.values;
  return (values ?? []).map(({ name, stringValue }) => ({ name, value: stringValue }));
}

export const RESERVED_EXAMPLE_HOST = /(^|\.)example$|(^|\.)example\.(com|org|net)$/;

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** URL of an HTTP node, built from `<field>` of the Config node: `={{ $('Config').first().json.<field> }}/…`. */
export function urlReadsConfig(url: string, field: string): boolean {
  const sources = [`\\$\\(['"]Config['"]\\)\\.(item|first\\(\\))\\.json`, `\\$node\\[['"]Config['"]\\]\\.json`];
  return new RegExp(`^=\\{\\{(${sources.join("|")})\\.${escapeRegExp(field)}\\}\\}/`).test(url.replace(/\s+/g, ""));
}

type CodeItem = { json: Record<string, unknown> };

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...parameters: string[]
) => (...values: unknown[]) => Promise<unknown>;

/**
 * Runs the `jsCode` of a Code node in "Run Once for Each Item" mode, as n8n does: `$json`, `$input`, `$(name)` and
 * `$node[name]` are available; the returned item (`{ json }` or a plain object) is normalized to its `json`.
 */
export async function runCodeNodeForItem(
  jsCode: string,
  input: Record<string, unknown>,
  nodeOutputs: Record<string, Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const item: CodeItem = { json: input };
  const outputs: Record<string, Record<string, unknown>> = { ...nodeOutputs };
  const reference = (name: string) => {
    const json = outputs[name];
    if (json === undefined) {
      throw new Error(`the Code node reads node "${name}", which is not available in this test`);
    }
    return { item: { json }, first: () => ({ json }), last: () => ({ json }), all: () => [{ json }] };
  };
  const nodeProxy = new Proxy({}, { get: (_target, name: string) => ({ json: reference(name).item.json }) });
  const $input = { item, first: () => item, last: () => item, all: () => [item] };

  const run = new AsyncFunction("$json", "$input", "$", "$node", "$item", jsCode);
  const result = await run(input, $input, reference, nodeProxy, () => item);
  const single = Array.isArray(result) ? result[0] : result;
  if (typeof single !== "object" || single === null) {
    throw new Error("the Code node returned no item");
  }
  const json = (single as Partial<CodeItem>).json;
  return (typeof json === "object" && json !== null ? json : single) as Record<string, unknown>;
}

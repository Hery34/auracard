#!/usr/bin/env node
// Garde-fou de périmètre d'écriture.
// - Session principale (orchestrateur, pas d'agent_id) : écriture limitée à docs/tasks, docs/adr, docs/journal.md.
// - Sous-agents : écriture limitée au périmètre déclaré dans SCOPES.
// Code de sortie 2 = blocage ; le message sur stderr est renvoyé à Claude.
// Source : PreToolUse transmet agent_id / agent_type quand l'appel vient d'un sous-agent
// (https://code.claude.com/docs/en/hooks).

import { readFileSync } from "node:fs";
import path from "node:path";

const ORCHESTRATOR_ALLOWED = ["docs/tasks/", "docs/adr/", "docs/journal.md"];

const TEST_FILE = [/\.test\.tsx?$/, /\.spec\.tsx?$/];

const SCOPES = {
  "db-architect": ["supabase/"],
  backend: [
    "src/domain/",
    "src/server/",
    "src/proxy.ts",
    "package.json",
    "pnpm-lock.yaml",
    "next.config.ts",
    "tsconfig.json",
    "eslint.config.mjs",
    ".github/",
    "pnpm-workspace.yaml",
  ],
  scheduling: ["src/domain/booking/", "src/server/booking/"],
  frontend: ["src/app/", "src/ui/", "public/"],
  integrations: ["n8n/", "src/server/adapters/"],
  "test-engineer": ["tests/", "supabase/tests/"],
  reviewer: [],
  "security-auditor": [],
};

// Le domaine booking appartient à `scheduling`, les adaptateurs à `integrations`.
const EXCLUSIONS = {
  backend: ["src/domain/booking/", "src/server/booking/", "src/server/adapters/"],
  "db-architect": ["supabase/tests/"],
};

function block(message) {
  process.stderr.write(`[guard-scope] ${message}\n`);
  process.exit(2);
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  block("Entrée du hook illisible : écriture refusée par précaution.");
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const rawPath = input?.tool_input?.file_path || input?.tool_input?.notebook_path;
if (!rawPath) process.exit(0);

const rel = path
  .relative(projectDir, path.resolve(projectDir, rawPath))
  .split(path.sep)
  .join("/");
if (rel.startsWith("..")) block(`Écriture hors du projet refusée : ${rawPath}`);

const matches = (prefixes) =>
  prefixes.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));

// Session principale = orchestrateur
if (!input.agent_id) {
  if (matches(ORCHESTRATOR_ALLOWED)) process.exit(0);
  block(
    `L'orchestrateur ne code pas. « ${rel} » doit être confié à un sous-agent via une fiche docs/tasks/. ` +
      `Zones autorisées : ${ORCHESTRATOR_ALLOWED.join(", ")}.`,
  );
}

const agent = input.agent_type;
const scope = SCOPES[agent];
if (!scope) block(`Agent inconnu « ${agent} » : aucun périmètre déclaré, écriture refusée.`);

const isTestFile = TEST_FILE.some((re) => re.test(rel));
if (agent === "test-engineer") {
  if (isTestFile || matches(scope)) process.exit(0);
  block(`test-engineer n'écrit que des tests (tests/, *.test.ts, *.spec.ts) : « ${rel} » refusé.`);
}
if (isTestFile) {
  block(`« ${rel} » est un fichier de test : seul test-engineer le modifie.`);
}

// Fichiers de configuration à la racine : backend (sauf les documents protégés).
const ROOT_PROTECTED = ["CLAUDE.md", "README.md"];
if (agent === "backend" && !rel.includes("/") && !ROOT_PROTECTED.includes(rel)) process.exit(0);

if (matches(EXCLUSIONS[agent] || [])) block(`« ${rel} » est hors du périmètre de ${agent}.`);
if (matches(scope)) process.exit(0);

block(`« ${rel} » est hors du périmètre de ${agent} (${scope.join(", ") || "lecture seule"}).`);

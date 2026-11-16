import { execFileSync } from "node:child_process";

/**
 * Vitest `globalSetup` of the integration suite: when the Supabase variables are missing from the
 * environment, reads them from the running local stack (`supabase status -o env`). Nothing is read
 * from nor written to any `.env*` file; the values only live in `process.env` of this run.
 * Safety guard: the suite hard-deletes accounts, so a preset URL must point to the local stack.
 */
const FROM_SUPABASE_STATUS = {
  NEXT_PUBLIC_SUPABASE_URL: "API_URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "ANON_KEY",
  SUPABASE_SERVICE_ROLE_KEY: "SERVICE_ROLE_KEY",
} as const;

export const ALLOW_REMOTE_VARIABLE = "CARNET_INTEGRATION_ALLOW_REMOTE";

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);

const STACK_DOWN_MESSAGE =
  "Tests d'intégration : la pile Supabase locale ne répond pas (`supabase status` a échoué). " +
  "Lancez `supabase start`, ou définissez NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY " +
  "et SUPABASE_SERVICE_ROLE_KEY dans l'environnement.";

/** Pure guard: throws unless the URL targets 127.0.0.1 or localhost, or `allowRemote` is set. */
export function assertLocalSupabaseUrl(url: string, allowRemote = false): void {
  if (allowRemote) {
    return;
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch (cause) {
    throw new Error(`Tests d'intégration : NEXT_PUBLIC_SUPABASE_URL n'est pas une URL valide (${url}).`, { cause });
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Tests d'intégration : ils ne tournent que contre la pile locale (hôte 127.0.0.1 ou localhost), ` +
        `or NEXT_PUBLIC_SUPABASE_URL vise « ${host} ». Ils suppriment des comptes : ${ALLOW_REMOTE_VARIABLE}=1 pour forcer en connaissance de cause.`,
    );
  }
}

function readSupabaseStatus(): Record<string, string> {
  let output: string;
  try {
    output = execFileSync("supabase", ["status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    throw new Error(STACK_DOWN_MESSAGE, { cause });
  }

  const values: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      values[match[1]] = match[2];
    }
  }
  return values;
}

export default function setup(): void {
  const presetUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (presetUrl !== undefined && presetUrl !== "") {
    assertLocalSupabaseUrl(presetUrl, process.env[ALLOW_REMOTE_VARIABLE] === "1");
  }

  const missing = (Object.keys(FROM_SUPABASE_STATUS) as Array<keyof typeof FROM_SUPABASE_STATUS>).filter(
    (name) => process.env[name] === undefined || process.env[name] === "",
  );

  if (missing.length > 0) {
    const status = readSupabaseStatus();
    for (const name of missing) {
      const source = FROM_SUPABASE_STATUS[name];
      const value = status[source];
      if (value === undefined || value === "") {
        throw new Error(`Tests d'intégration : ${source} absent de la sortie de \`supabase status -o env\`. ${STACK_DOWN_MESSAGE}`);
      }
      process.env[name] = value;
    }
  }
}

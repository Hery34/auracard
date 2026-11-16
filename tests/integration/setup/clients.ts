import { createClient } from "@supabase/supabase-js";

import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";
import type { Database } from "@/server/infrastructure/supabase/database.types";

export type { CarnetClient };

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} manquante : le globalSetup tests/integration/setup/supabase-env.ts doit être déclaré dans vitest.config.mts (pile locale démarrée).`,
    );
  }
  return value;
}

const clientOptions = {
  db: { schema: "carnet" as const },
  auth: { persistSession: false, autoRefreshToken: false },
};

/** `service_role` client: fixtures, cleanup and the adapters that the ADR 0011 reserves to it. */
export function adminClient(): CarnetClient {
  return createClient<Database, "carnet">(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    clientOptions,
  );
}

/** Anonymous client carrying, in memory, the session of the account it signs in: stands for the per-request server client. */
export function anonClient(): CarnetClient {
  return createClient<Database, "carnet">(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    clientOptions,
  );
}

import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/server/infrastructure/env";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";
import type { Database } from "@/server/infrastructure/supabase/database.types";

/**
 * `service_role` client (ADR 0011): bypasses RLS, used by the adapters the ADR lists.
 * Imported by `src/server/container.ts` only (ESLint `no-restricted-imports`).
 */
export function createAdminClient(): CarnetClient {
  return createClient<Database, "carnet">(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "carnet" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

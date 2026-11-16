import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/server/infrastructure/env";
import type { CarnetClient } from "@/server/infrastructure/supabase/carnet-client";
import type { Database } from "@/server/infrastructure/supabase/database.types";

/** Anonymous-key client without cookies nor session: public reads compatible with static rendering. */
export function createPublicSupabaseClient(): CarnetClient {
  return createClient<Database, "carnet">(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: "carnet" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

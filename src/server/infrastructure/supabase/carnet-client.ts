import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/infrastructure/supabase/database.types";

/** Supabase client bound to the `carnet` schema, whatever the key (anon with session, or service_role). */
export type CarnetClient = SupabaseClient<Database, "carnet">;

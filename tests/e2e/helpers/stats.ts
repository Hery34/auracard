import { insertDailyAggregates, type DailyAggregateFixture } from "../../integration/setup/analytics";
import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";

export type { DailyAggregateFixture };

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): the aggregates are written behind the application. */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

/**
 * Calendar day in Europe/Paris, `days` days before the real today (the server reads the real clock). The suite only
 * uses offsets far from the period bounds, so a run crossing midnight in Paris still lands in the same periods.
 */
export function parisDaysAgo(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
  const [year, month, date] = today.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date - days)).toISOString().slice(0, 10);
}

export async function seedDailyAggregates(profileId: string, rows: readonly DailyAggregateFixture[]): Promise<void> {
  await insertDailyAggregates(admin(), profileId, rows);
}

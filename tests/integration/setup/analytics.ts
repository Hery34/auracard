import type { CarnetClient } from "./clients";

export type EventRow = {
  id: string;
  type: string;
  source: string;
  link_id: string | null;
  device_class: string;
  occurred_at: string;
};

/** Page size of `eventsOf`, under PostgREST max_rows (100 locally and on the shared instance). */
const EVENTS_PAGE = 100;

/** Raw events of a profile, read behind the application (service_role), oldest first; paginated past max_rows. */
export async function eventsOf(admin: CarnetClient, profileId: string): Promise<EventRow[]> {
  const events: EventRow[] = [];
  for (let offset = 0; ; offset += EVENTS_PAGE) {
    const { data, error } = await admin
      .from("analytics_events")
      .select("id, type, source, link_id, device_class, occurred_at")
      .eq("profile_id", profileId)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + EVENTS_PAGE - 1);
    if (error !== null) {
      throw error;
    }
    events.push(...data);
    if (data.length < EVENTS_PAGE) {
      return events;
    }
  }
}

/** Fixture: publishes the profile directly (service_role), without Server Action. */
export async function publishProfile(admin: CarnetClient, profileId: string): Promise<void> {
  const { error } = await admin.from("profiles").update({ is_published: true }).eq("id", profileId);
  if (error !== null) {
    throw error;
  }
}

/** Fixture: one link of the profile at `position`; returns its id. */
export async function insertLink(admin: CarnetClient, profileId: string, position = 0): Promise<string> {
  const { data, error } = await admin
    .from("links")
    .insert({ profile_id: profileId, position, platform: "linkedin", url: `https://www.linkedin.com/in/it-${position}`, label: null })
    .select("id")
    .single();
  if (error !== null) {
    throw error;
  }
  return data.id;
}

export type RpcSpy = { client: CarnetClient; properties: string[]; functions: string[]; calls: { fn: string; args: unknown }[] };

/**
 * Wraps a real client: every property read on it, every rpc function name and its arguments are recorded, so a test
 * can prove that an adapter only calls `rpc(...)` (decision 8 of 0029, ADR 0011) and with which arguments (0030).
 */
export function spyOnClient(client: CarnetClient): RpcSpy {
  const properties: string[] = [];
  const functions: string[] = [];
  const calls: { fn: string; args: unknown }[] = [];
  const proxy = new Proxy(client, {
    get(target, property, receiver) {
      properties.push(String(property));
      if (property === "rpc") {
        return (fn: string, ...rest: unknown[]) => {
          functions.push(fn);
          calls.push({ fn, args: rest[0] });
          return (target.rpc as (...args: unknown[]) => unknown).call(target, fn, ...rest);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { client: proxy, properties, functions, calls };
}

export type DailyAggregateFixture = {
  day: string;
  metric: string;
  linkId: string | null;
  source: string | null;
  value: number;
};

/** Fixture: rows of `carnet.analytics_daily` written behind the application (service_role), as the aggregation would. */
export async function insertDailyAggregates(
  admin: CarnetClient,
  profileId: string,
  rows: readonly DailyAggregateFixture[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const { error } = await admin
    .from("analytics_daily")
    .insert(rows.map(({ day, metric, linkId, source, value }) => ({ profile_id: profileId, day, metric, link_id: linkId, source, value })));
  if (error !== null) {
    throw error;
  }
}

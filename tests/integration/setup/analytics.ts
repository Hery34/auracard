import type { CarnetClient } from "./clients";

export type EventRow = {
  id: string;
  type: string;
  source: string;
  link_id: string | null;
  device_class: string;
  occurred_at: string;
};

/** Raw events of a profile, read behind the application (service_role), oldest first. */
export async function eventsOf(admin: CarnetClient, profileId: string): Promise<EventRow[]> {
  const { data, error } = await admin
    .from("analytics_events")
    .select("id, type, source, link_id, device_class, occurred_at")
    .eq("profile_id", profileId)
    .order("occurred_at", { ascending: true });
  if (error !== null) {
    throw error;
  }
  return data;
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

export type RpcSpy = { client: CarnetClient; properties: string[]; functions: string[] };

/**
 * Wraps a real client: every property read on it and every rpc function name are recorded, so a test can prove that
 * an adapter only calls `rpc(...)` (decision 8 of 0029, ADR 0011).
 */
export function spyOnClient(client: CarnetClient): RpcSpy {
  const properties: string[] = [];
  const functions: string[] = [];
  const proxy = new Proxy(client, {
    get(target, property, receiver) {
      properties.push(String(property));
      if (property === "rpc") {
        return (fn: string, ...rest: unknown[]) => {
          functions.push(fn);
          return (target.rpc as (...args: unknown[]) => unknown).call(target, fn, ...rest);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { client: proxy, properties, functions };
}

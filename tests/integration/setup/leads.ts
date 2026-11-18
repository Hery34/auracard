import { randomUUID } from "node:crypto";

import type { CarnetClient } from "./clients";

export type LeadRow = { id: string; name: string; email: string; message: string; created_at: string; idempotency_key: string };

export type LeadFixture = { id?: string; name?: string; email?: string; message?: string; createdAt: string };

/** Page size of the reads behind the application, under PostgREST max_rows (100 locally and on the shared instance). */
const READ_PAGE = 100;

/** Fixture: `accepts_leads` written behind the application (service_role). */
export async function setAcceptsLeads(admin: CarnetClient, profileId: string, value: boolean): Promise<void> {
  const { error } = await admin.from("profiles").update({ accepts_leads: value }).eq("id", profileId);
  if (error !== null) {
    throw error;
  }
}

/** Fixture: leads inserted behind the application (service_role, ADR 0011 precision of 18/11/2026), dates chosen by the test. */
export async function insertLeads(admin: CarnetClient, profileId: string, rows: readonly LeadFixture[]): Promise<string[]> {
  const values = rows.map((row, index) => ({
    id: row.id ?? randomUUID(),
    profile_id: profileId,
    name: row.name ?? `Visiteur ${index}`,
    email: row.email ?? `visiteur-${index}@example.test`,
    message: row.message ?? `Message ${index}`,
    consent_at: row.createdAt,
    idempotency_key: randomUUID(),
    created_at: row.createdAt,
  }));
  for (let offset = 0; offset < values.length; offset += READ_PAGE) {
    const { error } = await admin.from("leads").insert(values.slice(offset, offset + READ_PAGE));
    if (error !== null) {
      throw error;
    }
  }
  return values.map((value) => value.id);
}

/** Every lead of a profile, read behind the application, newest first by (created_at, id); paginated past max_rows. */
export async function leadsOf(admin: CarnetClient, profileId: string): Promise<LeadRow[]> {
  const leads: LeadRow[] = [];
  for (let offset = 0; ; offset += READ_PAGE) {
    const { data, error } = await admin
      .from("leads")
      .select("id, name, email, message, created_at, idempotency_key")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + READ_PAGE - 1);
    if (error !== null) {
      throw error;
    }
    leads.push(...data);
    if (data.length < READ_PAGE) {
      return leads;
    }
  }
}

/** Outbox events of a profile, read behind the application. */
export async function outboxOf(admin: CarnetClient, profileId: string): Promise<{ type: string; payload: unknown }[]> {
  const { data, error } = await admin.from("outbox").select("type, payload").eq("profile_id", profileId);
  if (error !== null) {
    throw error;
  }
  return data;
}

/** `lead_submitted` events of a profile, read behind the application. */
export async function leadEventsOf(admin: CarnetClient, profileId: string): Promise<{ id: string; device_class: string }[]> {
  const { data, error } = await admin
    .from("analytics_events")
    .select("id, device_class")
    .eq("profile_id", profileId)
    .eq("type", "lead_submitted");
  if (error !== null) {
    throw error;
  }
  return data;
}

import type { CarnetClient } from "./clients";

export type QrRow = { id: string; code: string; profile_id: string; style: unknown; updated_at: string };

/** QR rows of a profile, read behind the application (service_role): zero or one (unique profile_id). */
export async function qrRowsOf(admin: CarnetClient, profileId: string): Promise<QrRow[]> {
  const { data, error } = await admin
    .from("qr_codes")
    .select("id, code, profile_id, style, updated_at")
    .eq("profile_id", profileId);
  if (error !== null) {
    throw error;
  }
  return data;
}

export async function qrRowOf(admin: CarnetClient, profileId: string): Promise<QrRow> {
  const rows = await qrRowsOf(admin, profileId);
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`expected one QR row for the profile, found ${rows.length}`);
  }
  return row;
}

export async function countQrRows(admin: CarnetClient): Promise<number> {
  const { count, error } = await admin.from("qr_codes").select("id", { count: "exact", head: true });
  if (error !== null || count === null) {
    throw error ?? new Error("count unavailable");
  }
  return count;
}

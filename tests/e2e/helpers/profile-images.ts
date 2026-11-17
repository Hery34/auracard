import { crc32, deflateSync } from "node:zlib";

import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";

export const MEDIA_BUCKET = "carnet-media";

/** Written in the GPS IFD of the test photo: must never reach the stored file. */
export const GPS_SENTINEL = "CARNET-E2E-GPS-48.8584N-2.2945E";

let client: CarnetClient | undefined;

/** `service_role` client of the local stack (same guard as `admin.ts`): reads behind the application only. */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

function supabaseUrl(): string {
  ensureSupabaseEnv();
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined || value === "") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
  }
  return value.replace(/\/+$/, "");
}

/** Public URL of an object of `carnet-media`, as the application must build it (0021, decision 5). */
export function publicMediaUrl(objectName: string): string {
  return `${supabaseUrl()}/storage/v1/object/public/${MEDIA_BUCKET}/${objectName}`;
}

export type ImageColumns = { avatar_url: string | null; banner_url: string | null; logo_url: string | null };

/** Object names stored in the profile row, read behind the application. */
export async function imageColumnsOf(profileId: string): Promise<ImageColumns> {
  const { data, error } = await admin()
    .from("profiles")
    .select("avatar_url, banner_url, logo_url")
    .eq("id", profileId)
    .single();
  if (error !== null) {
    throw error;
  }
  return data;
}

/** Names of the objects in the profile's folder of `carnet-media`, sorted. */
export async function objectsOf(profileId: string): Promise<string[]> {
  const { data, error } = await admin().storage.from(MEDIA_BUCKET).list(profileId);
  if (error !== null) {
    throw error;
  }
  return data.map((object) => `${profileId}/${object.name}`).sort();
}

/** Deletes the profile's folder (the global teardown deletes accounts, not Storage objects). */
export async function deleteFolder(profileId: string): Promise<void> {
  const names = await objectsOf(profileId);
  if (names.length > 0) {
    const { error } = await admin().storage.from(MEDIA_BUCKET).remove(names);
    if (error !== null) {
      throw error;
    }
  }
}

export type DetectedFormat = "jpeg" | "png" | "webp" | "unknown";

export function formatOf(bytes: Uint8Array): DetectedFormat {
  const ascii = (start: number, end: number) => Buffer.from(bytes.subarray(start, end)).toString("latin1");
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return "unknown";
}

/**
 * Traces of the source metadata in a stored file: the GPS sentinel, a PNG `eXIf` chunk, or a GPSInfo tag (0x8825,
 * either byte order) inside an EXIF block (JPEG APP1 `Exif\0\0`, WebP `EXIF` chunk). An encoder may write an EXIF
 * block of its own (colour space, dimensions): only what came from the photo, or any position, is a failure.
 */
export function exifTracesOf(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString("latin1");
  const traces = [GPS_SENTINEL, "eXIf"].filter((marker) => text.includes(marker));
  const hasExifBlock = text.includes("Exif\0\0") || text.includes("EXIF");
  if (hasExifBlock && (text.includes("\x88\x25\x00\x04") || text.includes("\x25\x88\x04\x00"))) {
    traces.push("GPSInfo");
  }
  return traces;
}

// ---------------------------------------------------------------------------------------------------------------
// Test photo: a real PNG (decodable by the browsers), larger than the 512 px of the avatar, carrying an `eXIf` chunk
// with a GPS IFD (GPSLatitudeRef "N" and GPSAreaInformation = GPS_SENTINEL).

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function ifdEntry(tag: number, type: number, count: number, value: Buffer): Buffer {
  const entry = Buffer.alloc(12);
  entry.writeUInt16BE(tag, 0);
  entry.writeUInt16BE(type, 2);
  entry.writeUInt32BE(count, 4);
  value.copy(entry, 8, 0, 4);
  return entry;
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

/** Big-endian TIFF: IFD0 (GPSInfo → GPS IFD), GPS IFD (GPSLatitudeRef, GPSAreaInformation), then the sentinel. */
function exifWithGps(): Buffer {
  const sentinel = Buffer.from(GPS_SENTINEL, "ascii");
  const ifd0Offset = 8;
  const gpsOffset = ifd0Offset + 2 + 12 + 4;
  const sentinelOffset = gpsOffset + 2 + 2 * 12 + 4;
  return Buffer.concat([
    Buffer.from("MM\0*", "latin1"),
    uint32(ifd0Offset),
    Buffer.from([0x00, 0x01]),
    ifdEntry(0x8825, 4, 1, uint32(gpsOffset)),
    uint32(0),
    Buffer.from([0x00, 0x02]),
    ifdEntry(0x0001, 2, 2, Buffer.from("N\0\0\0", "latin1")),
    ifdEntry(0x001c, 7, sentinel.length, uint32(sentinelOffset)),
    uint32(0),
    sentinel,
  ]);
}

/** Solid-colour RGB PNG of `width` × `height` with the GPS EXIF above (a few kilobytes once compressed). */
export function photoWithGpsExif(width = 1200, height = 900, rgb: [number, number, number] = [0x2e, 0x86, 0xc1]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("eXIf", exifWithGps()),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A text file presented as a PNG (name and declared type lie). */
export const FAKE_PNG = {
  name: "faux.png",
  mimeType: "image/png",
  buffer: Buffer.from("Ceci n'est pas une image, juste un texte renommé .png\n", "utf8"),
} as const;

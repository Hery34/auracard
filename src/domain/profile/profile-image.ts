import { err, ok, type Result } from "@/domain/shared/result";

export const PROFILE_IMAGE_KINDS = ["avatar", "banner", "logo"] as const;

export type ProfileImageKind = (typeof PROFILE_IMAGE_KINDS)[number];

export function isProfileImageKind(value: unknown): value is ProfileImageKind {
  return typeof value === "string" && (PROFILE_IMAGE_KINDS as readonly string[]).includes(value);
}

/** `file_size_limit` of the bucket `carnet-media` (ADR 0014). */
export const PROFILE_IMAGE_MAX_BYTES = 2_097_152;

export type ImageFormat = "jpeg" | "png" | "webp";

export const IMAGE_FORMATS: Readonly<
  Record<
    ImageFormat,
    {
      contentType: "image/jpeg" | "image/png" | "image/webp";
      extension: "jpg" | "png" | "webp";
      vcardType: "JPEG" | "PNG" | "WEBP";
    }
  >
> = {
  jpeg: { contentType: "image/jpeg", extension: "jpg", vcardType: "JPEG" },
  png: { contentType: "image/png", extension: "png", vcardType: "PNG" },
  webp: { contentType: "image/webp", extension: "webp", vcardType: "WEBP" },
};

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Real type from the signature bytes only, never from a file name nor a declared type. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, JPEG_SIGNATURE)) return "jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "webp";
  return null;
}

/** Largest accepted width or height, in pixels (the banner width). */
export const PROFILE_IMAGE_MAX_DIMENSION = 1500;

export type ImageDimensions = { width: number; height: number };

function uint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function uint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function uint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function uint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function uint32LE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset + 3]! << 24) | (bytes[offset + 2]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset]!) >>> 0;
}

const IHDR = [0x49, 0x48, 0x44, 0x52];

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24 || !startsWith(bytes, IHDR, 12)) return null;
  return { width: uint32BE(bytes, 16), height: uint32BE(bytes, 20) };
}

const JPEG_NOT_FRAME = new Set([0xc4, 0xc8, 0xcc]);
const JPEG_START_OF_SCAN = 0xda;
const JPEG_END_OF_IMAGE = 0xd9;

/** Walks the marker segments by their length, so that a frame inside a payload (EXIF thumbnail) is never read. */
function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && !JPEG_NOT_FRAME.has(marker)) {
      if (offset + 9 > bytes.length) return null;
      return { width: uint16BE(bytes, offset + 7), height: uint16BE(bytes, offset + 5) };
    }
    if (marker === JPEG_START_OF_SCAN || marker === JPEG_END_OF_IMAGE) return null;
    const length = uint16BE(bytes, offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

const VP8 = [0x56, 0x50, 0x38, 0x20];
const VP8L = [0x56, 0x50, 0x38, 0x4c];
const VP8X = [0x56, 0x50, 0x38, 0x58];
const VP8_START_CODE = [0x9d, 0x01, 0x2a];
const VP8L_SIGNATURE = 0x2f;

/** First chunk at offset 12, its payload at offset 20. */
function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (startsWith(bytes, VP8, 12)) {
    if (bytes.length < 30 || !startsWith(bytes, VP8_START_CODE, 23)) return null;
    return { width: uint16LE(bytes, 26) & 0x3fff, height: uint16LE(bytes, 28) & 0x3fff };
  }
  if (startsWith(bytes, VP8L, 12)) {
    if (bytes.length < 25 || bytes[20] !== VP8L_SIGNATURE) return null;
    const bits = uint32LE(bytes, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (startsWith(bytes, VP8X, 12)) {
    if (bytes.length < 30) return null;
    return { width: uint24LE(bytes, 24) + 1, height: uint24LE(bytes, 27) + 1 };
  }
  return null;
}

const DIMENSION_READERS: Readonly<Record<ImageFormat, (bytes: Uint8Array) => ImageDimensions | null>> = {
  jpeg: jpegDimensions,
  png: pngDimensions,
  webp: webpDimensions,
};

/** Width and height from the header only (no decoding); unknown format, truncated header or a zero side → `null`. */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const format = detectImageFormat(bytes);
  if (format === null) return null;
  const dimensions = DIMENSION_READERS[format](bytes);
  return dimensions === null || dimensions.width === 0 || dimensions.height === 0 ? null : dimensions;
}

export type ProfileImageError = "invalid_file" | "too_large";

export function validateProfileImage(bytes: Uint8Array): Result<ImageFormat, ProfileImageError> {
  if (bytes.length > PROFILE_IMAGE_MAX_BYTES) {
    return err("too_large");
  }
  const format = detectImageFormat(bytes);
  if (format === null) {
    return err("invalid_file");
  }
  const dimensions = readImageDimensions(bytes);
  if (
    dimensions === null ||
    dimensions.width > PROFILE_IMAGE_MAX_DIMENSION ||
    dimensions.height > PROFILE_IMAGE_MAX_DIMENSION
  ) {
    return err("invalid_file");
  }
  return ok(format);
}

/** `<profileId>/<kind>-<uuid>.<extension>`, uuid in lower case. */
export function profileImageObjectName(input: {
  profileId: string;
  kind: ProfileImageKind;
  uuid: string;
  format: ImageFormat;
}): string {
  return `${input.profileId}/${input.kind}-${input.uuid.toLowerCase()}.${IMAGE_FORMATS[input.format].extension}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Same pattern as `carnet.is_valid_media_name`. */
const OBJECT_NAME_PATTERN = new RegExp(`^${UUID}/(avatar|banner|logo)-${UUID}\\.(jpg|png|webp)$`);

export function isProfileImageObjectName(name: string): boolean {
  return OBJECT_NAME_PATTERN.test(name);
}

export const MEDIA_BUCKET = "carnet-media";

/** Public URL of an object of `carnet-media`; none, or a stored value outside the pattern (never trusted) → `null`. */
export function publicMediaUrl(origin: string, objectName: string | null): string | null {
  if (objectName === null || !isProfileImageObjectName(objectName)) {
    return null;
  }
  return `${origin.replace(/\/+$/, "")}/storage/v1/object/public/${MEDIA_BUCKET}/${objectName}`;
}

/**
 * Byte builders for the image checks of 0021: the server reads the signature and the dimensions in the header (no
 * decoding), the rest of the file is filler. `size` is the total length in bytes.
 */
export type ImageFixtureFormat = "jpeg" | "png" | "webp";

export const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const ASCII = new TextEncoder();

function filled(prefix: readonly number[], size: number): Uint8Array {
  if (size < prefix.length) {
    throw new Error(`imageBytes: ${size} bytes cannot hold a ${prefix.length}-byte header`);
  }
  const bytes = new Uint8Array(size).fill(0x2a);
  bytes.set(prefix, 0);
  return bytes;
}

export type WebpChunk = "VP8 " | "VP8L" | "VP8X";

/** JPEG start-of-frame markers: SOF0 baseline, SOF1 extended, SOF2 progressive. */
export const SOF0 = 0xc0;
export const SOF1 = 0xc1;
export const SOF2 = 0xc2;

/** Side of the default fixture (well under PROFILE_IMAGE_MAX_DIMENSION). */
export const DEFAULT_IMAGE_SIDE = 64;

export type ImageHeaderOptions = {
  width?: number;
  height?: number;
  /** JPEG only: start-of-frame marker (default SOF0). */
  sof?: number;
  /** WebP only: first chunk (default `VP8 `, lossy). */
  webpChunk?: WebpChunk;
};

function uint16BE(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function uint16LE(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function uint24LE(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

function uint32BE(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function uint32LE(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** A JPEG marker segment: `FF <marker>`, big-endian length (payload + 2), payload (filled with 0x00). */
export function jpegSegment(marker: number, payloadLength: number): number[] {
  return [0xff, marker, ...uint16BE(payloadLength + 2), ...new Array<number>(payloadLength).fill(0)];
}

/** A start-of-frame segment: precision 8, height then width (big endian), 3 components. */
export function jpegStartOfFrame(marker: number, width: number, height: number): number[] {
  return [
    0xff,
    marker,
    ...uint16BE(17),
    0x08,
    ...uint16BE(height),
    ...uint16BE(width),
    0x03,
    ...[0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
  ];
}

/** PNG signature + IHDR chunk (length 13, type, width and height big endian, depth 8, RGB, CRC omitted). */
function pngHeader(width: number, height: number): number[] {
  return [...PNG_SIGNATURE, ...uint32BE(13), ...ASCII.encode("IHDR"), ...uint32BE(width), ...uint32BE(height), 8, 2, 0, 0, 0];
}

/** Payload of the first WebP chunk, carrying the canvas dimensions. */
function webpPayload(chunk: WebpChunk, width: number, height: number): number[] {
  switch (chunk) {
    case "VP8 ":
      return [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...uint16LE(width), ...uint16LE(height)];
    case "VP8L": {
      const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
      return [0x2f, ...uint32LE(bits >>> 0)];
    }
    case "VP8X":
      return [0x00, 0x00, 0x00, 0x00, ...uint24LE(width - 1), ...uint24LE(height - 1)];
  }
}

/** `RIFF` + little-endian size + `WEBP` + first chunk (four-character code, little-endian size, payload). */
function webpHeader(totalSize: number, chunk: WebpChunk, width: number, height: number): number[] {
  const payload = webpPayload(chunk, width, height);
  return [
    ...ASCII.encode("RIFF"),
    ...uint32LE(Math.max(totalSize - 8, 0)),
    ...ASCII.encode("WEBP"),
    ...ASCII.encode(chunk),
    ...uint32LE(payload.length),
    ...payload,
  ];
}

/**
 * The header of an image of `format` up to the dimension fields included (nothing after): signature, then PNG IHDR,
 * JPEG SOFn, or the first WebP chunk. Width and height default to DEFAULT_IMAGE_SIDE.
 */
export function imageHeader(format: ImageFixtureFormat, options: ImageHeaderOptions = {}, totalSize = 64): number[] {
  const width = options.width ?? DEFAULT_IMAGE_SIDE;
  const height = options.height ?? DEFAULT_IMAGE_SIDE;
  switch (format) {
    case "jpeg":
      return [0xff, 0xd8, ...jpegStartOfFrame(options.sof ?? SOF0, width, height)];
    case "png":
      return pngHeader(width, height);
    case "webp":
      return webpHeader(totalSize, options.webpChunk ?? "VP8 ", width, height);
  }
}

/**
 * A file of `format`, `size` bytes long (default 64): a well-formed header with readable dimensions
 * (DEFAULT_IMAGE_SIDE × DEFAULT_IMAGE_SIDE unless given), then filler.
 */
export function imageBytes(format: ImageFixtureFormat, size = 64, options: ImageHeaderOptions = {}): Uint8Array {
  return filled(imageHeader(format, options, size), size);
}

/** Arbitrary bytes from a text (a "fake image": a text file renamed `.png`). */
export function textBytes(text: string): Uint8Array {
  return ASCII.encode(text);
}

/** Bytes from a list of octets and ASCII strings, in order (`bytesOf("RIFF", [0, 0, 0, 0], "WAVE")`). */
export function bytesOf(...parts: ReadonlyArray<string | readonly number[]>): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? [...ASCII.encode(part)] : [...part])));
}

/** A `File` as the browser sends it in the form data of the Server Action. */
export function anImageFile(bytes: Uint8Array, name = "photo.jpg", type = "image/jpeg"): File {
  return new File([bytes.slice().buffer as ArrayBuffer], name, { type });
}

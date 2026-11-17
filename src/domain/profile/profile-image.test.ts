/**
 * Contract frozen by test-engineer (0021, decisions 1, 3, 4, 5, 9 and 12; ADR 0014).
 *
 * // src/domain/profile/profile-image.ts — pure TypeScript, no dependency on Next.js, Supabase nor Node
 * export const PROFILE_IMAGE_KINDS = ["avatar", "banner", "logo"] as const;
 * export type ProfileImageKind = (typeof PROFILE_IMAGE_KINDS)[number];
 * export function isProfileImageKind(value: unknown): value is ProfileImageKind;
 *
 * // = file_size_limit of the bucket `carnet-media` (2 MiB).
 * export const PROFILE_IMAGE_MAX_BYTES = 2_097_152;
 *
 * export type ImageFormat = "jpeg" | "png" | "webp";
 * export const IMAGE_FORMATS: Readonly<Record<ImageFormat, {
 *   contentType: "image/jpeg" | "image/png" | "image/webp";   // sent to Storage
 *   extension: "jpg" | "png" | "webp";                         // of the object name (set_profile_image regex)
 *   vcardType: "JPEG" | "PNG" | "WEBP";                        // PHOTO;TYPE=
 * }>>;
 *
 * // Real type from the signature bytes only (never a file name nor a declared MIME type):
 * //   JPEG FF D8 FF; PNG 89 50 4E 47 0D 0A 1A 0A; WebP "RIFF" + 4 bytes + "WEBP". Anything else → null.
 * export function detectImageFormat(bytes: Uint8Array): ImageFormat | null;
 *
 * // Decision 12: width and height read in the header only, without any dependency nor decoding:
 * //   PNG: first chunk IHDR (offset 12), width then height as unsigned 32-bit big endian.
 * //   JPEG: walk the marker segments from offset 2 (FF xx + big-endian length >= 2) up to the first start of frame
 * //     SOFn (C0–CF except C4 DHT, C8 JPG, CC DAC): height then width as 16-bit big endian after the precision byte.
 * //   WebP: first chunk at offset 12: `VP8 ` (start code 9D 01 2A, 14-bit little-endian width and height, the two
 * //     scale bits ignored), `VP8L` (signature 2F, then 14 bits width - 1, 14 bits height - 1), `VP8X` (24-bit
 * //     little-endian canvas width - 1 and height - 1 at offsets 24 and 27).
 * // Unknown format, truncated header, missing IHDR/SOFn/start code/signature, a JPEG segment length < 2 (no loop),
 * // a zero width or height → null. Never throws.
 * export function readImageDimensions(bytes: Uint8Array): { width: number; height: number } | null;
 * export const PROFILE_IMAGE_MAX_DIMENSION = 1500;
 *
 * export type ProfileImageError = "invalid_file" | "too_large";
 * // Empty → invalid_file; more than PROFILE_IMAGE_MAX_BYTES → too_large (whatever the content); unknown signature →
 * // invalid_file; unreadable dimensions, or width or height over PROFILE_IMAGE_MAX_DIMENSION → invalid_file;
 * // otherwise ok(format).
 * export function validateProfileImage(bytes: Uint8Array): Result<ImageFormat, ProfileImageError>;
 *
 * // `<profileId>/<kind>-<uuid in lower case>.<extension>` (decision 9: crypto.randomUUID(), lower case).
 * export function profileImageObjectName(input: {
 *   profileId: string; kind: ProfileImageKind; uuid: string; format: ImageFormat;
 * }): string;
 * // Same pattern as carnet.set_profile_image: lower-case uuid folder, kind, lower-case uuid, jpg|png|webp; no other
 * // segment, no query, no traversal.
 * export function isProfileImageObjectName(name: string): boolean;
 *
 * export const MEDIA_BUCKET = "carnet-media";
 * // `<origin>/storage/v1/object/public/carnet-media/<objectName>`; trailing slashes of the origin ignored;
 * // a name refused by isProfileImageObjectName → null (stored value never trusted, decision 5).
 * export function publicMediaUrl(origin: string, objectName: string): string | null;
 */
import { describe, expect, it } from "vitest";

import {
  detectImageFormat,
  IMAGE_FORMATS,
  isProfileImageKind,
  isProfileImageObjectName,
  MEDIA_BUCKET,
  PROFILE_IMAGE_KINDS,
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_IMAGE_MAX_DIMENSION,
  profileImageObjectName,
  publicMediaUrl,
  readImageDimensions,
  validateProfileImage,
} from "@/domain/profile/profile-image";
import { err, ok } from "@/domain/shared/result";

import { PROFILE_ID } from "../../../tests/builders/fake-registrar";
import {
  bytesOf,
  DEFAULT_IMAGE_SIDE,
  imageBytes,
  imageHeader,
  type ImageFixtureFormat,
  type ImageHeaderOptions,
  JPEG_SIGNATURE,
  jpegSegment,
  jpegStartOfFrame,
  PNG_SIGNATURE,
  SOF0,
  SOF1,
  SOF2,
  textBytes,
  type WebpChunk,
} from "../../../tests/builders/images";

const UUID = "1a2b3c4d-0000-4000-8000-000000000001";
const SUPABASE_ORIGIN = "https://supabase.carnet.example";
const AVATAR_NAME = `${PROFILE_ID}/avatar-${UUID}.jpg`;

describe("profile image kinds", () => {
  it("decision 1: avatar, banner and logo, in that order", () => {
    expect(PROFILE_IMAGE_KINDS).toStrictEqual(["avatar", "banner", "logo"]);
  });

  it.each(["avatar", "banner", "logo"])("isProfileImageKind(%s) → true", (kind) => {
    expect(isProfileImageKind(kind)).toBe(true);
  });

  it.each([["Avatar"], ["photo"], [""], [" avatar"], [null], [undefined], [1]])("isProfileImageKind(%j) → false", (value) => {
    expect(isProfileImageKind(value)).toBe(false);
  });
});

describe("IMAGE_FORMATS", () => {
  it("decision 1: content type, object extension and vCard type of each accepted format", () => {
    expect(IMAGE_FORMATS).toStrictEqual({
      jpeg: { contentType: "image/jpeg", extension: "jpg", vcardType: "JPEG" },
      png: { contentType: "image/png", extension: "png", vcardType: "PNG" },
      webp: { contentType: "image/webp", extension: "webp", vcardType: "WEBP" },
    });
  });
});

describe("detectImageFormat — real type from the signature bytes (criterion 2)", () => {
  it("JPEG: FF D8 FF", () => {
    expect(detectImageFormat(imageBytes("jpeg"))).toBe("jpeg");
    expect(detectImageFormat(Uint8Array.from(JPEG_SIGNATURE))).toBe("jpeg");
  });

  it("PNG: 89 50 4E 47 0D 0A 1A 0A", () => {
    expect(detectImageFormat(imageBytes("png"))).toBe("png");
    expect(detectImageFormat(Uint8Array.from(PNG_SIGNATURE))).toBe("png");
  });

  it("WebP: RIFF, any four size bytes, WEBP", () => {
    expect(detectImageFormat(imageBytes("webp"))).toBe("webp");
    expect(detectImageFormat(bytesOf("RIFF", [0xff, 0xff, 0xff, 0xff], "WEBP"))).toBe("webp");
  });

  it.each([
    ["an empty file", new Uint8Array()],
    ["a text file", textBytes("Ceci n'est pas une image, juste un texte renommé .png")],
    ["an SVG (script possible)", textBytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["an HTML page", textBytes("<!doctype html><title>x</title>")],
    ["a GIF", bytesOf("GIF89a", [0x01, 0x00, 0x01, 0x00])],
    ["a PDF", bytesOf("%PDF-1.7\n")],
    ["a HEIC", bytesOf([0x00, 0x00, 0x00, 0x18], "ftypheic")],
    ["a RIFF WAVE file (RIFF without WEBP)", bytesOf("RIFF", [0x24, 0, 0, 0], "WAVE")],
    ["a truncated WebP (RIFF + size + WEB)", bytesOf("RIFF", [0x24, 0, 0, 0], "WEB")],
    ["a truncated JPEG (FF D8)", Uint8Array.from([0xff, 0xd8])],
    ["a truncated PNG (first 7 bytes)", Uint8Array.from(PNG_SIGNATURE.slice(0, 7))],
    ["a PNG signature with one wrong byte", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b])],
    ["a JPEG signature not at offset 0", Uint8Array.from([0x00, 0xff, 0xd8, 0xff, 0xe0])],
    ["lower-case riff/webp", bytesOf("riff", [0x24, 0, 0, 0], "webp")],
  ])("%s → null", (_label, bytes) => {
    expect(detectImageFormat(bytes)).toBeNull();
  });
});

describe("validateProfileImage (criterion 2)", () => {
  it.each(["jpeg", "png", "webp"] as const)("a %s file → ok(format)", (format) => {
    expect(validateProfileImage(imageBytes(format, 4096))).toStrictEqual(ok(format));
  });

  it("an empty file → invalid_file", () => {
    expect(validateProfileImage(new Uint8Array())).toStrictEqual(err("invalid_file"));
  });

  it("a text file whatever its name or declared type (the server only sees bytes) → invalid_file", () => {
    expect(validateProfileImage(textBytes("Ceci n'est pas une image"))).toStrictEqual(err("invalid_file"));
  });

  it("2 MiB exactly (PROFILE_IMAGE_MAX_BYTES, the bucket limit) → accepted", () => {
    expect(PROFILE_IMAGE_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(validateProfileImage(imageBytes("jpeg", PROFILE_IMAGE_MAX_BYTES))).toStrictEqual(ok("jpeg"));
  });

  it("one byte over 2 MiB → too_large", () => {
    expect(validateProfileImage(imageBytes("png", PROFILE_IMAGE_MAX_BYTES + 1))).toStrictEqual(err("too_large"));
  });

  it("a file over 2 MiB that is not an image either → too_large (size checked whatever the content)", () => {
    expect(validateProfileImage(new Uint8Array(PROFILE_IMAGE_MAX_BYTES + 1))).toStrictEqual(err("too_large"));
  });

  it("pure: the bytes are not mutated", () => {
    const bytes = imageBytes("webp");
    const copy = bytes.slice();

    validateProfileImage(bytes);

    expect(bytes).toStrictEqual(copy);
  });
});

describe("profileImageObjectName (decisions 1 and 9)", () => {
  it.each([
    ["avatar", "jpeg", `${PROFILE_ID}/avatar-${UUID}.jpg`],
    ["banner", "png", `${PROFILE_ID}/banner-${UUID}.png`],
    ["logo", "webp", `${PROFILE_ID}/logo-${UUID}.webp`],
  ] as const)("%s in %s → <profile_id>/<kind>-<uuid>.<ext>", (kind, format, expected) => {
    expect(profileImageObjectName({ profileId: PROFILE_ID, kind, uuid: UUID, format })).toBe(expected);
  });

  it("decision 9: the uuid is written in lower case", () => {
    const name = profileImageObjectName({ profileId: PROFILE_ID, kind: "avatar", uuid: UUID.toUpperCase(), format: "png" });

    expect(name).toBe(`${PROFILE_ID}/avatar-${UUID}.png`);
  });

  it("the generated name is accepted by isProfileImageObjectName (same pattern as set_profile_image)", () => {
    for (const kind of PROFILE_IMAGE_KINDS) {
      for (const format of ["jpeg", "png", "webp"] as const) {
        expect(isProfileImageObjectName(profileImageObjectName({ profileId: PROFILE_ID, kind, uuid: UUID, format }))).toBe(
          true,
        );
      }
    }
  });
});

describe("isProfileImageObjectName", () => {
  it.each([
    ["a full URL (value stored before 0021)", "https://cdn.example/avatar.jpg"],
    ["an absolute path", `/${AVATAR_NAME}`],
    ["a traversal", `${PROFILE_ID}/../${PROFILE_ID}/avatar-${UUID}.jpg`],
    ["an extra segment", `${PROFILE_ID}/x/avatar-${UUID}.jpg`],
    ["an unknown kind", `${PROFILE_ID}/photo-${UUID}.jpg`],
    ["the .jpeg extension", `${PROFILE_ID}/avatar-${UUID}.jpeg`],
    ["the .gif extension", `${PROFILE_ID}/avatar-${UUID}.gif`],
    ["an upper-case uuid", `${PROFILE_ID}/avatar-${UUID.toUpperCase()}.jpg`],
    ["an upper-case folder", `${PROFILE_ID.toUpperCase()}/avatar-${UUID}.jpg`],
    ["a folder that is not a uuid", `elodie/avatar-${UUID}.jpg`],
    ["a query string", `${AVATAR_NAME}?download=1`],
    ["a fragment", `${AVATAR_NAME}#x`],
    ["an encoded slash", `${PROFILE_ID}%2Favatar-${UUID}.jpg`],
    ["a trailing newline", `${AVATAR_NAME}\n`],
    ["an empty string", ""],
  ])("%s → false", (_label, name) => {
    expect(isProfileImageObjectName(name)).toBe(false);
  });
});

describe("publicMediaUrl (decision 5)", () => {
  it("MEDIA_BUCKET is carnet-media", () => {
    expect(MEDIA_BUCKET).toBe("carnet-media");
  });

  it("<origin>/storage/v1/object/public/carnet-media/<name>", () => {
    expect(publicMediaUrl(SUPABASE_ORIGIN, AVATAR_NAME)).toBe(
      `${SUPABASE_ORIGIN}/storage/v1/object/public/carnet-media/${AVATAR_NAME}`,
    );
  });

  it("the local stack origin (http://127.0.0.1:54321) is used as configured", () => {
    expect(publicMediaUrl("http://127.0.0.1:54321", AVATAR_NAME)).toBe(
      `http://127.0.0.1:54321/storage/v1/object/public/carnet-media/${AVATAR_NAME}`,
    );
  });

  it("a trailing slash of the configured origin does not double the slash", () => {
    expect(publicMediaUrl(`${SUPABASE_ORIGIN}/`, AVATAR_NAME)).toBe(
      `${SUPABASE_ORIGIN}/storage/v1/object/public/carnet-media/${AVATAR_NAME}`,
    );
  });

  it.each([
    ["a full URL stored before 0021", "https://tracker.example/pixel.png"],
    ["a traversal", `${PROFILE_ID}/../../../auth/v1/admin/users`],
    ["an empty name", ""],
  ])("a stored value that is not an object name of the pattern (%s) → null", (_label, name) => {
    expect(publicMediaUrl(SUPABASE_ORIGIN, name)).toBeNull();
  });
});

describe("readImageDimensions — width and height from the header (decision 12)", () => {
  const variants: ReadonlyArray<[string, ImageFixtureFormat, ImageHeaderOptions]> = [
    ["PNG (IHDR)", "png", {}],
    ["JPEG baseline (SOF0)", "jpeg", { sof: SOF0 }],
    ["JPEG extended (SOF1)", "jpeg", { sof: SOF1 }],
    ["JPEG progressive (SOF2)", "jpeg", { sof: SOF2 }],
    ...(["VP8 ", "VP8L", "VP8X"] as const).map(
      (chunk: WebpChunk): [string, ImageFixtureFormat, ImageHeaderOptions] => [`WebP (${chunk})`, "webp", { webpChunk: chunk }],
    ),
  ];

  it.each(variants)("%s: width and height read as written, width first", (_label, format, options) => {
    expect(readImageDimensions(imageBytes(format, 128, { ...options, width: 640, height: 480 }))).toStrictEqual({
      width: 640,
      height: 480,
    });
    expect(readImageDimensions(imageBytes(format, 128, { ...options, width: 3, height: 1500 }))).toStrictEqual({
      width: 3,
      height: 1500,
    });
  });

  it.each(variants)("%s: large dimensions are read too (refusal is validateProfileImage's job)", (_label, format, options) => {
    expect(readImageDimensions(imageBytes(format, 128, { ...options, width: 4000, height: 3000 }))).toStrictEqual({
      width: 4000,
      height: 3000,
    });
  });

  it.each(variants)("%s: every truncation before the end of the dimension fields → null", (_label, format, options) => {
    const header = imageHeader(format, { ...options, width: 640, height: 480 });
    const dimensionsEnd = { png: 24, jpeg: 11, webp: header.length }[format];

    for (let length = 0; length < dimensionsEnd; length += 1) {
      expect(readImageDimensions(Uint8Array.from(header.slice(0, length))), `${length} bytes`).toBeNull();
    }
  });

  it("the default fixture is DEFAULT_IMAGE_SIDE square, well under the limit", () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      expect(readImageDimensions(imageBytes(format))).toStrictEqual({ width: DEFAULT_IMAGE_SIDE, height: DEFAULT_IMAGE_SIDE });
    }
  });

  describe("PNG", () => {
    it("width and height are unsigned 32-bit: 0xFFFFFFFF is read as 4294967295, never as a negative number", () => {
      const bytes = imageBytes("png", 64, { width: 0xffffffff, height: 10 });

      expect(readImageDimensions(bytes)).toStrictEqual({ width: 4_294_967_295, height: 10 });
    });

    it("a first chunk other than IHDR → null", () => {
      const bytes = imageBytes("png", 64, { width: 100, height: 100 });
      bytes.set([...new TextEncoder().encode("tEXt")], 12);

      expect(readImageDimensions(bytes)).toBeNull();
    });
  });

  describe("JPEG", () => {
    it("the segments before the frame (APP0, APP1 EXIF, DQT, DHT C4) are skipped by their length", () => {
      const bytes = bytesOf(
        [0xff, 0xd8],
        jpegSegment(0xe0, 14),
        jpegSegment(0xe1, 600),
        jpegSegment(0xdb, 65),
        jpegSegment(0xc4, 28),
        jpegStartOfFrame(SOF2, 1200, 800),
      );

      expect(readImageDimensions(bytes)).toStrictEqual({ width: 1200, height: 800 });
    });

    it("a DHT segment (FF C4) is not a start of frame, even when its payload looks like dimensions", () => {
      const dht = [0xff, 0xc4, 0x00, 0x0b, 0x08, 0x00, 0x05, 0x00, 0x07, 0x03, 0x00, 0x00, 0x00];
      const bytes = bytesOf([0xff, 0xd8], dht, jpegStartOfFrame(SOF0, 300, 200));

      expect(readImageDimensions(bytes)).toStrictEqual({ width: 300, height: 200 });
    });

    it("a start of frame inside an APP1 payload (EXIF thumbnail) is not read: the frame of the image is", () => {
      const thumbnail = jpegStartOfFrame(SOF0, 160, 120);
      const app1 = [0xff, 0xe1, 0x00, thumbnail.length + 2 + 6, ...new TextEncoder().encode("Exif"), 0, 0, ...thumbnail];
      const bytes = bytesOf([0xff, 0xd8], app1, jpegStartOfFrame(SOF0, 4000, 3000));

      expect(readImageDimensions(bytes)).toStrictEqual({ width: 4000, height: 3000 });
      expect(validateProfileImage(bytes)).toStrictEqual(err("invalid_file"));
    });

    it("no start of frame before the end of the file → null", () => {
      expect(readImageDimensions(bytesOf([0xff, 0xd8], jpegSegment(0xe0, 14), jpegSegment(0xdb, 65)))).toBeNull();
    });

    it("a segment whose length runs past the end of the file → null", () => {
      expect(readImageDimensions(bytesOf([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00], new Array<number>(20).fill(0)))).toBeNull();
    });

    it.each([0, 1])("a segment length of %i (malformed) → null, without looping", (length) => {
      const bytes = bytesOf([0xff, 0xd8, 0xff, 0xe0, 0x00, length], new Array<number>(64).fill(0));

      expect(readImageDimensions(bytes)).toBeNull();
    });

    it("a byte other than FF where a marker is expected → null", () => {
      const bytes = bytesOf([0xff, 0xd8, 0x00, 0xc0], jpegStartOfFrame(SOF0, 300, 200));

      expect(readImageDimensions(bytes)).toBeNull();
    });
  });

  describe("WebP", () => {
    it("VP8: the two scale bits of each dimension are ignored", () => {
      const bytes = imageBytes("webp", 64, { webpChunk: "VP8 ", width: 0xc000 | 700, height: 0x4000 | 500 });

      expect(readImageDimensions(bytes)).toStrictEqual({ width: 700, height: 500 });
    });

    it("VP8: a missing start code (9D 01 2A) → null", () => {
      const bytes = imageBytes("webp", 64, { webpChunk: "VP8 ", width: 100, height: 100 });
      bytes.set([0x00, 0x00, 0x00], 23);

      expect(readImageDimensions(bytes)).toBeNull();
    });

    it("VP8L: a missing signature byte (2F) → null", () => {
      const bytes = imageBytes("webp", 64, { webpChunk: "VP8L", width: 100, height: 100 });
      bytes[20] = 0x00;

      expect(readImageDimensions(bytes)).toBeNull();
    });

    it("VP8X: 24-bit canvas dimensions (a 20000 px canvas is read, not truncated to 16 bits)", () => {
      expect(readImageDimensions(imageBytes("webp", 64, { webpChunk: "VP8X", width: 20_000, height: 2 }))).toStrictEqual({
        width: 20_000,
        height: 2,
      });
    });

    it("an unknown first chunk (VP8Z, ALPH) → null", () => {
      for (const code of ["VP8Z", "ALPH"]) {
        const bytes = imageBytes("webp", 64, { width: 100, height: 100 });
        bytes.set([...new TextEncoder().encode(code)], 12);

        expect(readImageDimensions(bytes), code).toBeNull();
      }
    });

    it("RIFF + WEBP only (no chunk) → null", () => {
      expect(readImageDimensions(bytesOf("RIFF", [0x04, 0, 0, 0], "WEBP"))).toBeNull();
    });
  });

  it.each([
    ["PNG", "png", {}],
    ["JPEG", "jpeg", {}],
    ["WebP VP8", "webp", { webpChunk: "VP8 " }],
  ] as const)("%s: a zero width or height (illegible) → null", (_label, format, options) => {
    expect(readImageDimensions(imageBytes(format, 64, { ...options, width: 0, height: 10 }))).toBeNull();
    expect(readImageDimensions(imageBytes(format, 64, { ...options, width: 10, height: 0 }))).toBeNull();
  });

  it.each([
    ["an empty file", new Uint8Array()],
    ["a text file", textBytes("Ceci n'est pas une image")],
    ["a GIF (format not accepted, even with readable dimensions)", bytesOf("GIF89a", [0x0a, 0x00, 0x0a, 0x00])],
    ["a JPEG signature alone", Uint8Array.from(JPEG_SIGNATURE)],
    ["a PNG signature alone", Uint8Array.from(PNG_SIGNATURE)],
  ])("%s → null", (_label, bytes) => {
    expect(readImageDimensions(bytes)).toBeNull();
  });

  it("pure: the bytes are not mutated", () => {
    const bytes = imageBytes("png", 64, { width: 640, height: 480 });
    const copy = bytes.slice();

    readImageDimensions(bytes);

    expect(bytes).toStrictEqual(copy);
  });
});

describe("validateProfileImage — dimensions bounded on the server (decision 12)", () => {
  it("PROFILE_IMAGE_MAX_DIMENSION is 1500 (the banner width)", () => {
    expect(PROFILE_IMAGE_MAX_DIMENSION).toBe(1500);
  });

  const variants: ReadonlyArray<[string, ImageFixtureFormat, ImageHeaderOptions]> = [
    ["PNG", "png", {}],
    ["JPEG SOF0", "jpeg", { sof: SOF0 }],
    ["JPEG SOF2", "jpeg", { sof: SOF2 }],
    ["WebP VP8", "webp", { webpChunk: "VP8 " }],
    ["WebP VP8L", "webp", { webpChunk: "VP8L" }],
    ["WebP VP8X", "webp", { webpChunk: "VP8X" }],
  ];

  it.each(variants)("%s of 1500 × 1500 → accepted", (_label, format, options) => {
    expect(validateProfileImage(imageBytes(format, 4096, { ...options, width: 1500, height: 1500 }))).toStrictEqual(
      ok(format),
    );
  });

  it.each(variants)("%s of 1501 × 10 → invalid_file", (_label, format, options) => {
    expect(validateProfileImage(imageBytes(format, 4096, { ...options, width: 1501, height: 10 }))).toStrictEqual(
      err("invalid_file"),
    );
  });

  it.each(variants)("%s of 10 × 1501 → invalid_file", (_label, format, options) => {
    expect(validateProfileImage(imageBytes(format, 4096, { ...options, width: 10, height: 1501 }))).toStrictEqual(
      err("invalid_file"),
    );
  });

  it("a PNG of 4294967295 × 10 (unsigned read) → invalid_file", () => {
    expect(validateProfileImage(imageBytes("png", 64, { width: 0xffffffff, height: 10 }))).toStrictEqual(err("invalid_file"));
  });

  it.each([
    ["a JPEG signature without any start of frame", bytesOf([0xff, 0xd8], jpegSegment(0xe0, 14), new Array<number>(64).fill(0x2a))],
    ["a PNG signature followed by filler", bytesOf([...PNG_SIGNATURE], new Array<number>(64).fill(0x2a))],
    ["a WebP whose header stops at the chunk code", bytesOf("RIFF", [0x10, 0, 0, 0], "WEBPVP8 ")],
    ["a JPEG with a zero height", imageBytes("jpeg", 64, { width: 100, height: 0 })],
  ])("a valid signature with a truncated header or unreadable dimensions (%s) → invalid_file", (_label, bytes) => {
    expect(validateProfileImage(bytes)).toStrictEqual(err("invalid_file"));
  });

  it("the size is still checked first: over 2 MiB with dimensions over the limit → too_large", () => {
    expect(
      validateProfileImage(imageBytes("png", PROFILE_IMAGE_MAX_BYTES + 1, { width: 5000, height: 5000 })),
    ).toStrictEqual(err("too_large"));
  });
});

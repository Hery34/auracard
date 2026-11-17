import type { ProfileImageKind } from "@/domain/profile/profile-image";

type Box = { width: number; height: number };

/** 0021: avatar and logo within 512 px, banner within 1500 px on each side (server bound, decision 12); never enlarged. */
const MAX_BOX: Readonly<Record<ProfileImageKind, Box>> = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1500, height: 1500 },
  logo: { width: 512, height: 512 },
};

const QUALITY = 0.85;

export function targetSize(kind: ProfileImageKind, source: Box): Box {
  const box = MAX_BOX[kind];
  const scale = Math.min(1, box.width / source.width, box.height / source.height);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export type EncodedImage = { blob: Blob; extension: "webp" | "jpg" };

/**
 * Decodes, resizes and re-encodes in the browser, which drops every metadata of the source (EXIF, GPS). WebP when the
 * canvas can produce it, JPEG otherwise (WebKit), on a white background. `null`: the browser cannot decode the file.
 */
export async function reencodeImage(file: Blob, kind: ProfileImageKind): Promise<EncodedImage | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const size = targetSize(kind, bitmap);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    return null;
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  const webp = await toBlob(canvas, "image/webp");
  if (webp?.type === "image/webp") {
    return { blob: webp, extension: "webp" };
  }
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size.width, size.height);
  const jpeg = await toBlob(canvas, "image/jpeg");
  return jpeg?.type === "image/jpeg" ? { blob: jpeg, extension: "jpg" } : null;
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

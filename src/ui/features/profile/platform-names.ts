import type { LinkPlatform } from "@/domain/profile/link";

export const PLATFORM_NAMES: Readonly<Record<LinkPlatform, string>> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  github: "GitHub",
  youtube: "YouTube",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  website: "Site web",
  document: "Document",
};

/** Generic platforms show their label alone; a brand keeps its name beside a custom label. */
export const GENERIC_PLATFORMS: ReadonlySet<LinkPlatform> = new Set(["website", "document"]);

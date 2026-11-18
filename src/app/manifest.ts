import type { MetadataRoute } from "next";

// theme_color and background_color must stay equal to --background in globals.css.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AuraCard",
    short_name: "AuraCard",
    lang: "fr",
    start_url: "/",
    display: "standalone",
    theme_color: "#0A0A0C",
    background_color: "#0A0A0C",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

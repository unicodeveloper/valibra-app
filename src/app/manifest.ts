import type { MetadataRoute } from "next";

/**
 * The web app manifest, served at /manifest.webmanifest and linked from the head
 * automatically.
 *
 * This is what a phone reads when a reviewer adds the app to their home screen,
 * and what fills in the install card on Android. Colours match the light-theme
 * tokens in globals.css and the themeColor in layout.tsx, so the splash screen
 * and the address bar are the same paper as the app.
 *
 * `display: "standalone"` rather than fullscreen: the app is a reading and
 * annotation surface, and hiding the status bar on a device someone is working
 * from all day is a nuisance, not a feature.
 *
 * The icons point at the static brand assets generated from the selected logo,
 * so the install card, favicon and Open Graph logo all use the same mark.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenMLR: Medical-Legal-Regulatory review",
    short_name: "OpenMLR",
    description:
      "Open-source MLR review. Promotional claims checked against biomedical evidence, with citations on every finding.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f4f0",
    theme_color: "#f5f4f0",
    categories: ["productivity", "medical", "business"],
    icons: [
      { src: "/brand/openmlr-icon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/brand/openmlr-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/openmlr-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/brand/openmlr-apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}

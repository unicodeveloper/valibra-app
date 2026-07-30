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
 * The icons point at the routes app/icon.tsx generates — /icon/192 and /icon/512
 * are its `generateImageMetadata` ids, so the manifest and the <link> tags are
 * the same bytes rather than a second set to keep in sync.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenMLR — Medical-Legal-Regulatory review",
    short_name: "OpenMLR",
    description:
      "Open-source, Valyu-grounded MLR review. Every promotional claim checked against real biomedical evidence — every finding cited.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f4f0",
    theme_color: "#f5f4f0",
    categories: ["productivity", "medical", "business"],
    icons: [
      { src: "/icon/32", sizes: "32x32", type: "image/png" },
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}

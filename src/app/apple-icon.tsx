import { ImageResponse } from "next/og";

/**
 * The iOS home-screen icon, at the one size Apple asks for.
 *
 * Same mark as icon.tsx, with two differences iOS forces: no corner radius (iOS
 * masks the icon itself, and a pre-rounded icon ends up with a visible double
 * curve), and no transparency. The mark is inset a little further than the
 * favicon's, because iOS's mask cuts more off the corners than it looks like it
 * will.
 */
export const runtime = "nodejs";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0d6b5e",
        }}
      >
        <svg width={98} height={98} viewBox="0 0 24 24">
          <path
            d="M3.5 12.6 L9.4 18.5 L20.5 5.8"
            fill="none"
            stroke="#f5f4f0"
            strokeWidth="2.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}

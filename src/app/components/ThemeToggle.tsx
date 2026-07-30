"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: "light", label: "Light", hint: "Always light" },
  { id: "dark", label: "Dark", hint: "Always dark" },
];

export const THEME_KEY = "openmlr-theme";

/**
 * Theme control.
 *
 * The palette is driven entirely by `color-scheme` on <html> (see globals.css,
 * where every token is a `light-dark()` pair). So switching themes is a single
 * attribute write, and there is no second palette here to keep in sync.
 *
 * Light and dark only. The OS is still what decides the *initial* look — with no
 * stored preference the root keeps `color-scheme: light dark` and follows the
 * system, exactly as before — but it is no longer offered as a third button to
 * choose. The control answers "what am I looking at", and the first click pins
 * it. That does mean a reviewer cannot hand the decision back to the OS once
 * they've pinned it, short of clearing site data.
 */
export function ThemeToggle() {
  // Starts null so the first paint renders nothing selected. The real value is
  // read from <html> in the effect below: the inline script in layout.tsx has
  // already applied it before paint, so reading it here can't disagree with what
  // is on screen. Initialising from localStorage during render would run on the
  // server too, where it doesn't exist, and mismatch the hydrated markup.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const attr = document.documentElement.dataset.theme;
    if (attr === "light" || attr === "dark") {
      setTheme(attr);
      return;
    }
    // No stored preference: the page is following the OS, so show whichever of
    // the two it actually resolved to rather than leaving both unselected.
    setTheme(window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
  }

  return (
    <span className="seg theme-seg" role="group" aria-label="Colour theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.hint}
          aria-pressed={theme === t.id}
          onClick={() => choose(t.id)}
        >
          {t.label}
        </button>
      ))}
    </span>
  );
}

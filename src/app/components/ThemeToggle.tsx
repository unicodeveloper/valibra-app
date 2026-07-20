"use client";

import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: "system", label: "Auto", hint: "Follow the operating system" },
  { id: "light", label: "Light", hint: "Always light" },
  { id: "dark", label: "Dark", hint: "Always dark" },
];

export const THEME_KEY = "valibra-theme";

/**
 * Theme control.
 *
 * The palette is driven entirely by `color-scheme` on <html> (see globals.css,
 * where every token is a `light-dark()` pair). So switching themes is a single
 * attribute write, and there is no second palette here to keep in sync.
 *
 * Three states rather than a two-way switch, because "follow the OS" is a real
 * preference and not the same as "light". A binary toggle silently opts the
 * reviewer out of their system setting forever the first time they touch it.
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
    setTheme(attr === "light" || attr === "dark" ? attr : "system");
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    if (next === "system") {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem(THEME_KEY);
    } else {
      document.documentElement.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
    }
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

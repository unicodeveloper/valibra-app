"use client";

import { useEffect, useRef, useState } from "react";
import { SAMPLE_ASSETS, type SampleAsset } from "../sample-asset";

/**
 * "Load sample ▾" — a small popover of the demo assets.
 *
 * The compose panel used to ship a single fictional sample behind one button.
 * There are several real ones now, each written to surface a different lane of
 * the review, so the button becomes a menu: pick a drug, get its copy *and* a
 * matching asset name. Each row names what it demonstrates so the choice is
 * meaningful before you run it, not a mystery.
 *
 * Follows the same open/outside-click contract as the account menu.
 */
export function SampleMenu({
  onPick,
  disabled,
}: {
  onPick: (sample: SampleAsset) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click or Escape — bound only while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="sample-slot" ref={rootRef}>
      <button
        className="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        Load sample <span className="sample-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="sample-menu" role="menu">
          {SAMPLE_ASSETS.map((s) => (
            <button
              key={s.id}
              className="quiet sample-menu-item"
              role="menuitem"
              onClick={() => {
                onPick(s);
                setOpen(false);
              }}
            >
              <span className="sample-menu-drug">{s.drug}</span>
              <span className="sample-menu-hint">{s.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

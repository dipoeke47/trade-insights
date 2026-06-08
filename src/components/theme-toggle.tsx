"use client";

// Light/dark theme switch. Toggles the `.dark` / `.light` class on <html> and
// persists the choice to localStorage. The initial class is set pre-paint by an
// inline script in layout.tsx, so there's no flash; this just keeps it in sync.

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = (localStorage.getItem("theme") as Theme | null) ?? "dark";
    setTheme(stored);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:text-zinc-100"
    >
      {mounted ? (theme === "dark" ? "☀️ Light" : "🌙 Dark") : "🌓 Theme"}
    </button>
  );
}

"use client";

import { useTheme } from "../lib/theme";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Ubah ke tema terang" : "Ubah ke tema gelap"}
      title={theme === "dark" ? "Tema terang" : "Tema gelap"}
    >
      {theme === "dark" ? "☀️ Terang" : "🌙 Gelap"}
    </button>
  );
}

import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const LIGHT_THEME_COLOR = "#ffffff";
const DARK_THEME_COLOR = "#1c1b17";

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

function applyResolvedTheme(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
}

export function storedThemePreference(): ThemePreference {
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedThemePreference);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(preference));

  const setPreference = useCallback((next: ThemePreference) => {
    if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
    setPreferenceState(next);
  }, []);

  useEffect(() => {
    const apply = () => {
      const nextResolved = resolveTheme(preference);
      setResolved(nextResolved);
      applyResolvedTheme(nextResolved);
    };
    apply();
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  return { preference, setPreference, resolved };
}

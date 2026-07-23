// AIDEV-NOTE: Single owner of the theme mechanism. The root layout's inline script,
// AppShell's toggle, and Settings' appearance radios must all agree on these rules.
export type BoardTheme = "board-light" | "board-dark";

export const THEME_STORAGE_KEY = "board-theme";

export function resolveInitialTheme(): BoardTheme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "board-dark" || stored === "board-light") return stored;
  } catch {
    // Storage can be blocked by privacy settings; the branded light theme remains safe.
  }
  return "board-light";
}

/** Applies to the document and persists — the theme is the only persisted preference. */
export function applyTheme(theme: BoardTheme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Applying the theme must still work when persistence is unavailable.
  }
}

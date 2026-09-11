export type ThemeMode = "dark" | "light";
export type DensityMode = "cozy" | "compact";

export const THEME_KEY = "vault:ui:theme";
export const DENSITY_KEY = "vault:ui:density";

export function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

export function applyDensity(density: DensityMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = density;
}

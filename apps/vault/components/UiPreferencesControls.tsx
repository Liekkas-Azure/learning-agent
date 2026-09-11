"use client";

import { useEffect, useState } from "react";
import {
  applyDensity,
  applyTheme,
  DENSITY_KEY,
  type DensityMode as Density,
  THEME_KEY,
  type ThemeMode as Theme,
} from "@/lib/ui-preferences";

export function UiPreferencesControls() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [density, setDensity] = useState<Density>("cozy");

  useEffect(() => {
    const savedTheme = (window.localStorage.getItem(THEME_KEY) as Theme | null) ?? "dark";
    const savedDensity = (window.localStorage.getItem(DENSITY_KEY) as Density | null) ?? "cozy";
    setTheme(savedTheme);
    setDensity(savedDensity);
    applyTheme(savedTheme);
    applyDensity(savedDensity);
  }, []);

  function changeTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(THEME_KEY, next);
  }

  function changeDensity(next: Density) {
    setDensity(next);
    applyDensity(next);
    window.localStorage.setItem(DENSITY_KEY, next);
  }

  return (
    <div className="hidden lg:flex items-center gap-2">
      <div className="ai-muted-panel p-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => changeTheme("dark")}
          className={`rounded-lg px-2 py-1 text-xs transition ${theme === "dark" ? "bg-white/10 text-slate-100" : "text-slate-500"}`}
        >
          深色
        </button>
        <button
          type="button"
          onClick={() => changeTheme("light")}
          className={`rounded-lg px-2 py-1 text-xs transition ${theme === "light" ? "bg-white/10 text-slate-100" : "text-slate-500"}`}
        >
          浅色
        </button>
      </div>
      <div className="ai-muted-panel p-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => changeDensity("cozy")}
          className={`rounded-lg px-2 py-1 text-xs transition ${density === "cozy" ? "bg-white/10 text-slate-100" : "text-slate-500"}`}
        >
          舒适
        </button>
        <button
          type="button"
          onClick={() => changeDensity("compact")}
          className={`rounded-lg px-2 py-1 text-xs transition ${density === "compact" ? "bg-white/10 text-slate-100" : "text-slate-500"}`}
        >
          紧凑
        </button>
      </div>
    </div>
  );
}

// Color themes. The built-in theme lives in css/app.css. A custom theme
// overrides the CSS custom properties ("tokens") below for light and dark mode.
//
// Stored in OPFS: app/themes.json -> [{id, name, light:{...}, dark:{...}, prompt?, createdAt}]
// The active theme id is the "themeId" setting ("default" = built-in).
// To avoid a flash on startup, the active theme's CSS is also kept in
// localStorage ("paletteCSS") and applied by index.html before the app loads.
import { readJSON, writeJSON } from "./opfs.js";
import { getSettings, setSetting } from "./retention.js";

// The ten tokens a theme sets. The rest are derived from them.
export const THEME_KEYS = ["page", "surface", "surface-2", "surface-3", "ink", "ink-2", "muted", "border", "accent", "user-bubble"];
export const TOKEN_HELP = {
  page: "app background behind everything",
  surface: "cards, inputs, message composer",
  "surface-2": "sidebar and table headers",
  "surface-3": "hover states and progress tracks",
  ink: "main text",
  "ink-2": "secondary text",
  muted: "hints, axis labels, timestamps",
  border: "hairline borders",
  accent: "buttons, links, highlights",
  "user-bubble": "background of the user's chat bubbles",
};

export const DEFAULT_THEME = {
  id: "default",
  name: "Default",
  light: { page: "#f9f9f7", surface: "#fcfcfb", "surface-2": "#f2f1ee", "surface-3": "#e9e8e4", ink: "#0b0b0b", "ink-2": "#52514e", muted: "#898781", border: "#e2e1dc", accent: "#2a78d6", "user-bubble": "#e8eef8" },
  dark: { page: "#0d0d0d", surface: "#1a1a19", "surface-2": "#222220", "surface-3": "#2c2c2a", ink: "#f0efec", "ink-2": "#c3c2b7", muted: "#898781", border: "#2f2f2d", accent: "#3987e5", "user-bubble": "#1f2a3a" },
};

const FILE = "app/themes.json";
const HEX = /^#[0-9a-fA-F]{6}$/;

// ---------- color math ----------
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function mix(a, b, t) {
  const [p, q] = [rgb(a), rgb(b)];
  return "#" + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

// Fill in the derived tokens from the ten base tokens.
export function expand(t) {
  const accentInk = contrast(t.accent, "#ffffff") >= contrast(t.accent, "#0b0b0b") ? "#ffffff" : "#0b0b0b";
  return {
    ...t,
    "ink-3": mix(t["ink-2"], t.muted, 0.5),
    "border-strong": mix(t.border, t.ink, 0.15),
    "accent-ink": accentInk,
    "accent-soft": t.accent + "2e",
    grid: t["surface-3"],
    axis: mix(t.border, t.muted, 0.4),
  };
}

// Returns {ok, errors[], warnings[]} for a theme candidate.
export function checkTheme(theme) {
  const errors = [];
  const warnings = [];
  if (!theme || typeof theme !== "object") return { ok: false, errors: ["Not a theme object"], warnings };
  for (const mode of ["light", "dark"]) {
    const t = theme[mode];
    if (!t) {
      errors.push(`Missing "${mode}" colors`);
      continue;
    }
    for (const k of THEME_KEYS) if (!HEX.test(t[k] || "")) errors.push(`${mode}.${k} must be a color like #1a2b3c (got ${JSON.stringify(t[k])})`);
    if (errors.length) continue;
    const pairs = [
      ["ink", "page", 4.5, "Main text on the background"],
      ["ink", "surface", 4.5, "Main text on cards"],
      ["ink-2", "surface", 3, "Secondary text on cards"],
      ["ink", "user-bubble", 4.5, "Text in your chat bubbles"],
      ["accent", "page", 3, "Accent color on the background"],
    ];
    for (const [a, b, min, label] of pairs) {
      const c = contrast(t[a], t[b]);
      if (c < min) warnings.push(`${mode}: ${label} is hard to read (contrast ${c.toFixed(1)}:1, aim for ${min}:1)`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function themeCSS(theme) {
  const vars = (t) =>
    Object.entries(expand(t))
      .map(([k, v]) => `--${k}:${v};`)
      .join("");
  const sel = `:root[data-palette="${theme.id}"]`;
  return (
    `${sel}{color-scheme:light;${vars(theme.light)}}` +
    `@media (prefers-color-scheme: dark){${sel}:not([data-theme="light"]){color-scheme:dark;${vars(theme.dark)}}}` +
    `${sel}[data-theme="dark"]{color-scheme:dark;${vars(theme.dark)}}`
  );
}

// CSS for Studio apps: the active theme on :root, light and dark.
let activeTheme = null;
export function appThemeCSS(theme = activeTheme || DEFAULT_THEME) {
  const vars = (t, mode) =>
    Object.entries({ ...expand(t), "critical-ink": mode === "light" ? "#b42323" : "#e66767" })
      .map(([k, v]) => `--${k}:${v};`)
      .join("");
  return (
    `:root{color-scheme:light;${vars(theme.light, "light")}}` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;${vars(theme.dark, "dark")}}}` +
    `:root[data-theme="dark"]{color-scheme:dark;${vars(theme.dark, "dark")}}`
  );
}
// {mode, css} for appkit: light/dark follows the app's setting (system by default).
export function appTheme() {
  return { mode: getMode(), css: appThemeCSS() };
}

// ---------- storage ----------
export async function listThemes() {
  return (await readJSON(FILE, [])) || [];
}

export async function saveTheme(theme) {
  const all = await listThemes();
  const t = { ...theme, id: theme.id && theme.id !== "default" ? theme.id : "t" + Date.now().toString(36), createdAt: theme.createdAt || Date.now() };
  const i = all.findIndex((x) => x.id === t.id);
  if (i >= 0) all[i] = t;
  else all.push(t);
  await writeJSON(FILE, all);
  return t;
}

export async function deleteTheme(id) {
  await writeJSON(FILE, (await listThemes()).filter((t) => t.id !== id));
  if ((await getSettings()).themeId === id) await activateTheme("default");
}

// Applies a theme object to the page without saving it (used for previews).
export function applyTheme(theme) {
  const root = document.documentElement;
  let style = document.getElementById("custom-theme");
  if (!theme || theme.id === "default") {
    delete root.dataset.palette;
    if (style) style.textContent = "";
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = "custom-theme";
    document.head.append(style);
  }
  style.textContent = themeCSS(theme);
  root.dataset.palette = theme.id;
}

export async function activateTheme(id) {
  const theme = id === "default" ? null : (await listThemes()).find((t) => t.id === id);
  applyTheme(theme);
  activeTheme = theme || null;
  await setSetting("themeId", theme ? id : "default");
  try {
    if (theme) {
      localStorage.setItem("paletteCSS", themeCSS(theme));
      localStorage.setItem("palette", theme.id);
    } else {
      localStorage.removeItem("paletteCSS");
      localStorage.removeItem("palette");
    }
  } catch {
    /* storage unavailable; theme still applies after load */
  }
}

export async function restoreTheme() {
  const { themeId } = await getSettings();
  if (themeId && themeId !== "default") await activateTheme(themeId);
}

// Light / dark / system mode (separate from the palette).
export function setMode(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.dataset.theme = mode;
  else delete root.dataset.theme;
  try {
    localStorage.setItem("theme", mode);
  } catch {
    /* ignore */
  }
}
export function getMode() {
  try {
    return localStorage.getItem("theme") || "system";
  } catch {
    return "system";
  }
}

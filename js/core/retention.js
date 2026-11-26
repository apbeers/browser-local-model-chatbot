// App settings stored in OPFS, model "last used" tracking, and automatic
// deletion of downloaded models that haven't been used for N days.
import { readJSON, writeJSON } from "./opfs.js";
import { scanModelCache, deleteModelFromCache } from "./models.js";

const SETTINGS = "app/settings.json";
const USAGE = "app/model-usage.json";
const DAY = 86400000;
export const AUTO_DELETE_OPTIONS = [
  [0, "Never"],
  [30, "After 30 days unused"],
  [60, "After 60 days unused"],
  [90, "After 90 days unused"],
];

// autoDeleteDays: models; chatAutoDeleteDays: chats (0 = never). themeId: active color theme.
const DEFAULTS = { autoDeleteDays: 0, chatAutoDeleteDays: 0, showAllModels: false, themeId: "default" };
let settingsCache = null;

export async function getSettings() {
  if (!settingsCache) settingsCache = { ...DEFAULTS, ...((await readJSON(SETTINGS)) || {}) };
  return settingsCache;
}

export async function setSetting(key, value) {
  const s = await getSettings();
  s[key] = value;
  await writeJSON(SETTINGS, s);
  return s;
}

export async function getUsage() {
  return (await readJSON(USAGE)) || {};
}

export async function touchModel(id) {
  const u = await getUsage();
  u[id] = Date.now();
  await writeJSON(USAGE, u);
}

export function daysLeft(lastUsed, days) {
  if (!days || !lastUsed) return null;
  return Math.max(0, Math.ceil((lastUsed + days * DAY - Date.now()) / DAY));
}

// Deletes saved models not used within the configured window. Models already
// saved without a usage record start their clock now rather than being deleted.
// Returns the models it deleted.
export async function runAutoDelete(catalog, { keepId } = {}) {
  const { autoDeleteDays } = await getSettings();
  const usage = await getUsage();
  const scan = await scanModelCache(catalog);
  const now = Date.now();
  const deleted = [];
  let changed = false;
  for (const m of catalog.all) {
    const info = scan.byModel[m.id];
    if (!info || !info.bytes) continue;
    if (!usage[m.id]) {
      usage[m.id] = now;
      changed = true;
      continue;
    }
    if (autoDeleteDays && m.id !== keepId && now - usage[m.id] > autoDeleteDays * DAY) {
      await deleteModelFromCache(m, scan, catalog);
      delete usage[m.id];
      changed = true;
      deleted.push(m);
    }
  }
  if (changed) await writeJSON(USAGE, usage);
  return deleted;
}

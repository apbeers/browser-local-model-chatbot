// Custom UIs ("variants"). A variant is a set of file overrides for the UI layer.
// The default UI is the files served by the website and is never changed.
//
// Only paths matching OVERRIDABLE can be overridden (css/... and js/ui/...).
// Core services in js/core/, vendor/, sw.js, index.html and recover.html are locked.
//
// Storage (OPFS is the source of truth):
//   app/ui/index.json                 [{id, name, createdAt, updatedAt, apiVersion, appVersion}]
//   app/ui/<id>/files/<path>          the overriding file contents
//   app/ui/<id>/history.json          [{at, path, prev, note}]  prev = content before the change (null = file was new)
// Mirror for the service worker (sw.js serves overrides from here):
//   Cache "ui-<id>"                   one entry per file, keyed by the file's full URL
//   Cache "ui-meta"  "__ui/active"    {"id": "<active variant id>" | "default"}
import { readJSON, writeJSON, readText, writeText, remove, list } from "./opfs.js";
import { API_VERSION, APP_VERSION } from "./version.js";

export const OVERRIDABLE = /^(css\/[\w./-]+\.css|js\/ui\/[\w./-]+\.js)$/;
const ROOT = "app/ui";
const HISTORY_LIMIT = 60;
const SCOPE = new URL("../../", import.meta.url).href; // the app's base URL
const TYPES = { css: "text/css", js: "text/javascript" };

function uid() {
  return "ui-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function supported() {
  return "serviceWorker" in navigator && "caches" in window && !!navigator.serviceWorker.controller;
}

export async function listVariants() {
  return (await readJSON(`${ROOT}/index.json`, [])) || [];
}
async function saveIndex(all) {
  await writeJSON(`${ROOT}/index.json`, all);
}
export async function getVariant(id) {
  return (await listVariants()).find((v) => v.id === id) || null;
}

function check(path) {
  if (!OVERRIDABLE.test(path) || path.includes("..")) throw new Error(`"${path}" can't be customized. Only css/*.css and js/ui/*.js files can.`);
}

// ---------- active variant ----------
export async function getActive() {
  try {
    const r = await (await caches.open("ui-meta")).match(SCOPE + "__ui/active");
    return r ? (await r.json()).id || "default" : "default";
  } catch {
    return "default";
  }
}

export async function setActive(id) {
  const c = await caches.open("ui-meta");
  await c.put(SCOPE + "__ui/active", new Response(JSON.stringify({ id }), { headers: { "content-type": "application/json" } }));
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: "ui-changed" });
}

// ---------- files ----------
export async function listFiles(id) {
  const out = [];
  const walk = async (dir, prefix) => {
    for (const e of await list(`${ROOT}/${id}/files/${dir}`)) {
      if (e.kind === "directory") await walk(`${dir}${e.name}/`, `${prefix}${e.name}/`);
      else out.push(prefix + e.name);
    }
  };
  await walk("", "");
  return out.sort();
}

export async function readFile(id, path) {
  check(path);
  return readText(`${ROOT}/${id}/files/${path}`);
}

// The default (website) version of a file, bypassing any override.
export async function readDefault(path) {
  const res = await fetch(SCOPE + path + "?__default=1");
  return res.ok ? res.text() : null;
}

async function cachePut(id, path, text) {
  const ext = path.split(".").pop();
  await (await caches.open("ui-" + id)).put(SCOPE + path, new Response(text, { headers: { "content-type": TYPES[ext] || "text/plain" } }));
}

async function pushHistory(id, entry) {
  const h = (await readJSON(`${ROOT}/${id}/history.json`, [])) || [];
  h.push(entry);
  await writeJSON(`${ROOT}/${id}/history.json`, h.slice(-HISTORY_LIMIT));
}

export async function getHistory(id) {
  return (await readJSON(`${ROOT}/${id}/history.json`, [])) || [];
}

async function touch(id) {
  const all = await listVariants();
  const v = all.find((x) => x.id === id);
  if (v) {
    v.updatedAt = Date.now();
    v.apiVersion = API_VERSION;
    v.appVersion = APP_VERSION;
    await saveIndex(all);
  }
}

// Saves a file override (keeps the previous content in history).
export async function writeFile(id, path, text, note = "") {
  check(path);
  const prev = await readFile(id, path);
  await pushHistory(id, { at: Date.now(), path, prev, note });
  await writeText(`${ROOT}/${id}/files/${path}`, text);
  await cachePut(id, path, text);
  await touch(id);
}

// Removes an override so the default file is used again.
export async function resetFile(id, path, note = "Reset to default") {
  check(path);
  const prev = await readFile(id, path);
  if (prev == null) return;
  await pushHistory(id, { at: Date.now(), path, prev, note });
  await remove(`${ROOT}/${id}/files/${path}`);
  await (await caches.open("ui-" + id)).delete(SCOPE + path);
  await touch(id);
}

// Undo: restores the file to how it was before history entry `index`.
export async function revert(id, index) {
  const h = await getHistory(id);
  const e = h[index];
  if (!e) return;
  if (e.prev == null) await resetFile(id, e.path, `Undo: ${e.note || "change"}`);
  else await writeFile(id, e.path, e.prev, `Undo: ${e.note || "change"}`);
}

// ---------- variants ----------
export async function createVariant(name, { copyFrom = null } = {}) {
  const all = await listVariants();
  const now = Date.now();
  const v = { id: uid(), name: name || "My UI", createdAt: now, updatedAt: now, apiVersion: API_VERSION, appVersion: APP_VERSION };
  all.push(v);
  await saveIndex(all);
  if (copyFrom && copyFrom !== "default") {
    for (const p of await listFiles(copyFrom)) await writeFile(v.id, p, await readFile(copyFrom, p), "Copied");
  }
  return v;
}

export async function renameVariant(id, name) {
  const all = await listVariants();
  const v = all.find((x) => x.id === id);
  if (v) v.name = name;
  await saveIndex(all);
}

export async function deleteVariant(id) {
  if ((await getActive()) === id) await setActive("default");
  await saveIndex((await listVariants()).filter((v) => v.id !== id));
  await remove(`${ROOT}/${id}`, true);
  await caches.delete("ui-" + id);
}

// Rebuilds the Cache Storage mirror from OPFS (e.g. after the browser cleared caches).
export async function resync() {
  for (const v of await listVariants()) {
    await caches.delete("ui-" + v.id);
    for (const p of await listFiles(v.id)) await cachePut(v.id, p, await readFile(v.id, p));
  }
}

// ---------- drafts (preview a change before saving it) ----------
// A draft is a Cache-only copy of the UI ("ui-<id>-draft") plus the changed
// files. Preview it with ?ui=<id>-draft. Nothing is written to OPFS.
export const draftId = (id) => id + "-draft";

export async function stageDraft(id, files) {
  await caches.delete("ui-" + draftId(id));
  const src = await caches.open("ui-" + id);
  const dst = await caches.open("ui-" + draftId(id));
  for (const req of await src.keys()) await dst.put(req, await src.match(req));
  for (const [path, text] of Object.entries(files)) {
    check(path);
    await cachePut(draftId(id), path, text);
  }
}

export async function clearDraft(id) {
  await caches.delete("ui-" + draftId(id));
}

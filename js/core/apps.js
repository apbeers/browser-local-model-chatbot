// Studio apps: small single-file HTML tools (like artifacts), stored on device.
//
// OPFS layout:
//   app/apps/index.json            [{id, name, emoji, color, description, template, createdAt, updatedAt}]
//   app/apps/<id>/index.html       the saved app
//   app/apps/<id>/draft.html       the agent's work in progress (accept or discard)
//   app/apps/<id>/history.json     [{at, note, prev}]  prev = HTML before the change
//   app/apps/<id>/chat.json        the Studio conversation for this app
//   apps-data/<id>/kv.json         the app's own key/value storage (appkit.storage)
//   apps-data/<id>/files/<name>    the app's own files (appkit.files)
import { readJSON, writeJSON, readText, writeText, remove } from "./opfs.js";

const ROOT = "app/apps";
const HISTORY_LIMIT = 40;
const COLORS = ["#2a78d6", "#1baf7a", "#eb6834", "#6250d6", "#e34948", "#eda100", "#e87ba4", "#008300"];

function uid() {
  return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function listApps() {
  const all = (await readJSON(`${ROOT}/index.json`, [])) || [];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
async function saveIndex(all) {
  await writeJSON(`${ROOT}/index.json`, all);
}
export async function getApp(id) {
  return (await listApps()).find((a) => a.id === id) || null;
}
async function patch(id, fields) {
  const all = await listApps();
  const a = all.find((x) => x.id === id);
  if (!a) return null;
  Object.assign(a, fields, { updatedAt: Date.now() });
  await saveIndex(all);
  return a;
}

export async function createApp({ name = "New app", emoji = "✨", description = "", template = "blank", html = "" } = {}) {
  const all = await listApps();
  const now = Date.now();
  const a = { id: uid(), name, emoji, color: COLORS[all.length % COLORS.length], description, template, createdAt: now, updatedAt: now };
  all.push(a);
  await saveIndex(all);
  await writeText(`${ROOT}/${a.id}/index.html`, html);
  return a;
}

export const updateApp = patch;

export async function readApp(id) {
  return (await readText(`${ROOT}/${id}/index.html`)) || "";
}
export async function readDraft(id) {
  return readText(`${ROOT}/${id}/draft.html`);
}
export async function writeDraft(id, html) {
  await writeText(`${ROOT}/${id}/draft.html`, html);
}
export async function discardDraft(id) {
  await remove(`${ROOT}/${id}/draft.html`);
}

async function pushHistory(id, entry) {
  const h = (await readJSON(`${ROOT}/${id}/history.json`, [])) || [];
  h.push(entry);
  await writeJSON(`${ROOT}/${id}/history.json`, h.slice(-HISTORY_LIMIT));
}
export async function getHistory(id) {
  return (await readJSON(`${ROOT}/${id}/history.json`, [])) || [];
}

// Saves new HTML as the app (keeps the old version in history).
export async function saveApp(id, html, note = "") {
  const prev = await readApp(id);
  if (prev === html) return;
  await pushHistory(id, { at: Date.now(), note, prev });
  await writeText(`${ROOT}/${id}/index.html`, html);
  await patch(id, {});
}

export async function acceptDraft(id, note = "Accepted draft") {
  const d = await readDraft(id);
  if (d == null) return false;
  await saveApp(id, d, note);
  await discardDraft(id);
  return true;
}

export async function revert(id, index) {
  const h = await getHistory(id);
  const e = h[index];
  if (e) await saveApp(id, e.prev, `Undo: ${e.note || "change"}`);
}

export async function deleteApp(id, { keepData = false } = {}) {
  await saveIndex((await listApps()).filter((a) => a.id !== id));
  await remove(`${ROOT}/${id}`, true);
  if (!keepData) await remove(`apps-data/${id}`, true);
}

export async function getAppChat(id) {
  return (await readJSON(`${ROOT}/${id}/chat.json`, [])) || [];
}
export async function saveAppChat(id, messages) {
  await writeJSON(`${ROOT}/${id}/chat.json`, messages.slice(-80));
}

// ---------- the app's own data (used by the appkit bridge) ----------
const safeName = (n) => String(n).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

export async function kvGet(id) {
  return (await readJSON(`apps-data/${id}/kv.json`, {})) || {};
}
export async function kvSet(id, obj) {
  const text = JSON.stringify(obj);
  if (text.length > 5e6) throw new Error("App storage is full (5 MB limit for key/value data). Use appkit.files for big data.");
  await writeText(`apps-data/${id}/kv.json`, text);
}
export async function fileList(id) {
  const { list } = await import("./opfs.js");
  return (await list(`apps-data/${id}/files`)).filter((e) => e.kind === "file").map((e) => e.name);
}
export const fileRead = (id, name) => readText(`apps-data/${id}/files/${safeName(name)}`);
export const fileWrite = (id, name, text) => writeText(`apps-data/${id}/files/${safeName(name)}`, String(text));
export const fileRemove = (id, name) => remove(`apps-data/${id}/files/${safeName(name)}`);

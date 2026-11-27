// Storage manager: everything this app keeps in the browser, with labels that
// explain what each item is and where it came from.
//   OPFS (Origin Private File System): chats, stats, models, apps, ...
//   Cache Storage: the offline copy of the website, custom UI copies, pins
//   localStorage: small preferences
// Website files (the "shell-…" cache) can be viewed but not deleted.
import { getDir } from "./opfs.js";

// [path prefix, label, where it came from]
const LABELS = [
  ["app/chats", "Chats", "Your conversations"],
  ["app/projects.json", "Projects", "Your projects"],
  ["app/stats", "Stats", "Speed records from every model session"],
  ["app/apps", "Studio apps", "Apps you built in Studio"],
  ["apps-data", "App data", "Data saved by your Studio apps"],
  ["app/ui", "Custom UIs", "Your custom versions of this app"],
  ["app/usage", "Usage log", "Which features you use (no message text)"],
  ["app/themes.json", "Themes", "Your color themes"],
  ["app/settings.json", "Settings", "Your settings"],
  ["app/device.json", "Device name", "The name used in stats"],
  ["app/notes.json", "Notes", "Notes saved by the save_note tool"],
  ["app/model-usage.json", "Model use dates", "For auto-delete of unused models"],
  ["app/unsupported-recorded.json", "No-WebGPU marker", "Recorded once if this browser lacks WebGPU"],
  ["tvmjs-opfs-store", "Downloaded models", "Model files from Hugging Face and model libraries from GitHub, saved by WebLLM"],
];

export function describe(path) {
  const hit = LABELS.find(([p]) => path === p || path.startsWith(p + "/"));
  return hit ? { label: hit[1], source: hit[2], top: path === hit[0] } : { label: null, source: null, top: false };
}

async function handleFor(path) {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  const dir = await getDir(parts.join("/"), false);
  if (!name) return { dir, kind: "directory", handle: dir };
  for await (const [n, h] of dir.entries()) if (n === name) return { dir, kind: h.kind, handle: h, name };
  throw new Error("Not found: " + path);
}

// Lists one OPFS directory: [{name, path, kind, size}] (size for files only).
export async function listDir(path = "") {
  const dir = await getDir(path, false);
  const out = [];
  for await (const [name, h] of dir.entries()) {
    const p = path ? `${path}/${name}` : name;
    let size = null;
    if (h.kind === "file") size = (await h.getFile()).size;
    out.push({ name, path: p, kind: h.kind, size, ...describe(p) });
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
}

// Total size and file count of a directory (recursive).
export async function dirSize(path) {
  let bytes = 0;
  let files = 0;
  const walk = async (dir) => {
    for await (const [, h] of dir.entries()) {
      if (h.kind === "directory") await walk(h);
      else {
        bytes += (await h.getFile()).size;
        files++;
      }
    }
  };
  await walk(await getDir(path, false));
  return { bytes, files };
}

// Reads a file for viewing: {text} for text, or {binary: true, size, head}.
export async function readForView(path, max = 200000) {
  const { handle } = await handleFor(path);
  const file = await handle.getFile();
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const binary = head.some((b) => b === 0) || /\.bin$/.test(path);
  if (binary) return { binary: true, size: file.size, head: [...head].map((b) => b.toString(16).padStart(2, "0")).join(" ") };
  let text = await file.slice(0, max).text();
  if (/\.json$/.test(path) && file.size <= max) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* show as is */
    }
  }
  return { text, size: file.size, truncated: file.size > max };
}

// For a WebLLM cache payload (<hash>.bin), the URL it was downloaded from.
export async function modelFileSource(path) {
  if (!path.startsWith("tvmjs-opfs-store/") || !path.endsWith(".bin")) return null;
  try {
    const { handle: _, dir } = await handleFor(path);
    const rec = await dir.getFileHandle(path.split("/").pop().replace(/\.bin$/, ".record.json"));
    return JSON.parse(await (await rec.getFile()).text()).url;
  } catch {
    return null;
  }
}

export async function removePath(path) {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  const dir = await getDir(parts.join("/"), false);
  await dir.removeEntry(name, { recursive: true });
}

// ---------- Cache Storage ----------
export function describeCache(name) {
  if (name.startsWith("shell-")) return { label: "Website files (offline copy)", source: "Downloaded from this website so the app works offline", readOnly: true };
  if (name === "ui-meta") return { label: "Active UI setting", source: "Which custom UI is in use", readOnly: false };
  if (name.endsWith("-draft")) return { label: "Custom UI draft", source: "A Studio draft being previewed", readOnly: false };
  if (name.startsWith("ui-")) return { label: "Custom UI copy", source: "Copy of a custom UI's files for the offline app", readOnly: false };
  if (name === "pins") return { label: "Home Screen pins", source: "Manifests and icons of pinned Studio apps", readOnly: false };
  return { label: name, source: "Created by this site", readOnly: false };
}

export async function listCaches() {
  const out = [];
  for (const name of await caches.keys()) {
    const c = await caches.open(name);
    const keys = await c.keys();
    out.push({ name, entries: keys.length, ...describeCache(name) });
  }
  return out;
}

export async function listCacheEntries(name) {
  const c = await caches.open(name);
  const out = [];
  for (const req of await c.keys()) {
    const res = await c.match(req);
    const blob = res ? await res.clone().blob() : null;
    out.push({ url: req.url, size: blob ? blob.size : 0, type: res ? res.headers.get("content-type") || "" : "" });
  }
  return out;
}

export async function readCacheEntry(name, url, max = 200000) {
  const res = await (await caches.open(name)).match(url);
  if (!res) return null;
  const type = res.headers.get("content-type") || "";
  if (/image|octet|wasm/.test(type)) return { binary: true, size: (await res.blob()).size, type };
  const text = await res.text();
  return { text: text.slice(0, max), size: text.length, truncated: text.length > max, type };
}

export async function deleteCache(name) {
  if (describeCache(name).readOnly) throw new Error("Website files can't be deleted here.");
  await caches.delete(name);
}

export async function deleteCacheEntry(name, url) {
  if (describeCache(name).readOnly) throw new Error("Website files can't be deleted here.");
  await (await caches.open(name)).delete(url);
}

// ---------- breakdown: how much each part of the app stores ----------
// Returns {usage, quota, parts: [{group, label, bytes, source}]}, biggest first.
// group: "Models" (one row per downloaded model), "Your data", "Offline copies".
export async function breakdown(catalog, scanModelCache) {
  const parts = [];
  // Models, one row each (from WebLLM's cache records).
  if (catalog) {
    try {
      const scan = await scanModelCache(catalog);
      for (const m of catalog.all) {
        const b = scan.byModel[m.id];
        if (b && b.bytes) parts.push({ group: "Models", label: m.label, bytes: b.bytes, source: "Downloaded from Hugging Face" });
      }
      if (scan.other.bytes) parts.push({ group: "Models", label: "Leftover model files", bytes: scan.other.bytes, source: "Not used by any listed model" });
    } catch {
      /* no OPFS */
    }
  }
  // Your data in OPFS (everything except the model store).
  const seen = new Set();
  for (const [path, label, source] of LABELS) {
    if (path === "tvmjs-opfs-store") continue;
    try {
      let bytes;
      if (path.endsWith(".json")) {
        const parts2 = path.split("/");
        const name = parts2.pop();
        const dir = await getDir(parts2.join("/"), false);
        bytes = (await (await dir.getFileHandle(name)).getFile()).size;
      } else bytes = (await dirSize(path)).bytes;
      seen.add(path);
      if (bytes) parts.push({ group: "Your data", label, bytes, source });
    } catch {
      /* doesn't exist */
    }
  }
  // Cache Storage, grouped by kind.
  if ("caches" in globalThis) {
    const sums = {};
    for (const name of await caches.keys()) {
      const d = describeCache(name);
      const c = await caches.open(name);
      let bytes = 0;
      for (const req of await c.keys()) {
        const res = await c.match(req);
        if (res) bytes += (await res.clone().blob()).size;
      }
      const key = d.label;
      sums[key] = sums[key] || { group: "Offline copies", label: key, bytes: 0, source: d.source };
      sums[key].bytes += bytes;
    }
    parts.push(...Object.values(sums).filter((p) => p.bytes));
  }
  let usage = null;
  let quota = null;
  try {
    const e = await navigator.storage.estimate();
    usage = e.usage;
    quota = e.quota;
  } catch {
    /* ignore */
  }
  return { usage, quota, parts: parts.sort((a, b) => b.bytes - a.bytes) };
}

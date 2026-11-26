// Inspect and delete WebLLM's OPFS model cache.
// WebLLM (cacheBackend "opfs") stores each fetched URL as <hash>.bin plus a
// <hash>.record.json ({url, nbytes}) under /tvmjs-opfs-store/<scope>/...
// We index those records by URL and work out, per model, exactly which files
// are present using the model's own tensor-cache.json manifest.

import { getDir, walk } from "./opfs.js";

const STORE = "tvmjs-opfs-store";

export async function scanModelCache(catalog) {
  const byUrl = new Map();
  let dir = null;
  try {
    dir = await getDir(STORE, false);
  } catch {
    /* nothing cached yet */
  }
  if (dir) {
    await walk(dir, async (fh, parts, parent) => {
      if (!fh.name.endsWith(".record.json")) return;
      try {
        const rec = JSON.parse(await (await fh.getFile()).text());
        const base = fh.name.slice(0, -".record.json".length);
        byUrl.set(rec.url, { parent, record: fh.name, payload: base + ".bin", url: rec.url, nbytes: rec.nbytes || 0 });
      } catch {
        /* unreadable record */
      }
    });
  }

  const byModel = {};
  const claimed = new Set();
  for (const m of catalog.all) {
    const entries = [];
    for (const [url, e] of byUrl) if (url.startsWith(m.modelUrl)) entries.push(e);
    if (!entries.length) continue; // a shared library alone doesn't make a model "saved"
    if (byUrl.has(m.libUrl)) entries.push(byUrl.get(m.libUrl));
    entries.forEach((e) => claimed.add(e.url));
    const info = { entries, bytes: entries.reduce((a, e) => a + e.nbytes, 0), files: entries.length, complete: false, fraction: 0 };
    const manifest = byUrl.get(m.modelUrl + "tensor-cache.json");
    if (manifest) {
      try {
        const fh = await manifest.parent.getFileHandle(manifest.payload);
        const json = JSON.parse(await (await fh.getFile()).text());
        const shards = json.records || [];
        const need = shards.reduce((a, r) => a + (r.nbytes || 0), 0);
        let have = 0;
        let all = true;
        for (const r of shards) {
          const e = byUrl.get(m.modelUrl + r.dataPath);
          if (e && e.nbytes === r.nbytes) have += r.nbytes;
          else all = false;
        }
        const tok = byUrl.has(m.modelUrl + "tokenizer.json") || byUrl.has(m.modelUrl + "tokenizer.model");
        info.complete = all && tok && byUrl.has(m.modelUrl + "mlc-chat-config.json") && byUrl.has(m.libUrl);
        info.fraction = need ? have / need : 0;
      } catch {
        /* treat as partial */
      }
    }
    byModel[m.id] = info;
  }
  const otherEntries = [...byUrl.values()].filter((e) => !claimed.has(e.url));
  const other = { entries: otherEntries, files: otherEntries.length, bytes: otherEntries.reduce((a, e) => a + e.nbytes, 0) };
  return { byModel, other };
}

export function cacheInfo(model, scan) {
  return (scan && scan.byModel[model.id]) || { bytes: 0, files: 0, complete: false, fraction: 0, entries: [] };
}

async function removeEntries(entries) {
  for (const e of entries) {
    for (const name of [e.payload, e.record]) {
      try {
        await e.parent.removeEntry(name);
      } catch {
        /* already gone */
      }
    }
  }
}

// Deletes a model's files. A model library shared with another saved model
// (e.g. Qwen2.5 0.5B and Qwen2.5 Coder 0.5B) is kept so that model still works offline.
export async function deleteModelFromCache(model, scan, catalog) {
  const info = scan.byModel[model.id];
  if (!info) return;
  const sharedLib = catalog.all.some((o) => o.id !== model.id && o.libUrl === model.libUrl && scan.byModel[o.id]);
  await removeEntries(info.entries.filter((e) => !(sharedLib && e.url === model.libUrl)));
}

export async function deleteOrphans(scan) {
  await removeEntries(scan.other.entries);
}

export async function deleteAllModelCache() {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(STORE, { recursive: true });
  } catch {
    /* nothing cached */
  }
}

export function fmtBytes(n) {
  if (n == null || !Number.isFinite(n)) return "–";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  if (n < 1e9) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

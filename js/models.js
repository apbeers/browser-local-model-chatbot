// Inspect and delete WebLLM's OPFS model cache.
// WebLLM (cacheBackend "opfs") stores each fetched URL as <hash>.bin plus a
// <hash>.record.json ({url, nbytes}) under /tvmjs-opfs-store/<scope>/...
// We scan the record files and group them by model URL prefix.

import { getDir, walk } from "./opfs.js";

const STORE = "tvmjs-opfs-store";

export async function scanModelCache(catalog) {
  const byModel = {};
  for (const m of catalog.models) byModel[m.id] = { bytes: 0, files: 0, entries: [] };
  const other = { bytes: 0, files: 0, entries: [] };
  let dir;
  try {
    dir = await getDir(STORE, false);
  } catch {
    return { byModel, other };
  }
  await walk(dir, async (fh, parts, parent) => {
    if (!fh.name.endsWith(".record.json")) return;
    let rec;
    try {
      rec = JSON.parse(await (await fh.getFile()).text());
    } catch {
      return;
    }
    const base = fh.name.slice(0, -".record.json".length);
    const entry = { parent, record: fh.name, payload: base + ".bin", url: rec.url, nbytes: rec.nbytes || 0 };
    const owner = catalog.models.find((m) => rec.url.startsWith(m.modelUrl) || rec.url === m.libUrl);
    const bucket = owner ? byModel[owner.id] : other;
    bucket.bytes += entry.nbytes;
    bucket.files += 1;
    bucket.entries.push(entry);
  });
  return { byModel, other };
}

// Fraction (0..1) of a model's expected bytes present in the cache.
export function cachedFraction(model, scan) {
  const b = scan.byModel[model.id];
  if (!b || !model.bytes) return 0;
  return Math.min(1, b.bytes / (model.bytes + 1));
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

export async function deleteModelFromCache(model, scan) {
  const b = scan.byModel[model.id];
  if (b) await removeEntries(b.entries);
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
  if (!Number.isFinite(n)) return "–";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

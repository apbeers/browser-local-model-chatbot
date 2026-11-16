// Small helpers over the Origin Private File System (OPFS).
// All app data (chats, stats, settings) lives under /app; WebLLM's model cache
// lives under /tvmjs-opfs-store and is managed by models.js.

const queues = new Map(); // path -> promise chain, serialises writes per file

export function opfsAvailable() {
  return !!(navigator.storage && navigator.storage.getDirectory);
}

async function root() {
  return navigator.storage.getDirectory();
}

function split(path) {
  return path.split("/").filter(Boolean);
}

export async function getDir(path, create = true) {
  let dir = await root();
  for (const part of split(path)) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function getFileHandle(path, create) {
  const parts = split(path);
  const name = parts.pop();
  const dir = await getDir(parts.join("/"), create);
  return dir.getFileHandle(name, { create });
}

export async function readText(path) {
  try {
    const fh = await getFileHandle(path, false);
    const file = await fh.getFile();
    return await file.text();
  } catch (err) {
    if (err && (err.name === "NotFoundError" || err.name === "TypeError")) return null;
    throw err;
  }
}

export async function readJSON(path, fallback = null) {
  const text = await readText(path);
  if (text == null || text === "") return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function enqueue(path, fn) {
  const prev = queues.get(path) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(path, next);
  next.finally(() => {
    if (queues.get(path) === next) queues.delete(path);
  });
  return next;
}

export function writeText(path, text) {
  return enqueue(path, async () => {
    const fh = await getFileHandle(path, true);
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  });
}

export function writeJSON(path, value) {
  return writeText(path, JSON.stringify(value));
}

export async function remove(path, recursive = false) {
  const parts = split(path);
  const name = parts.pop();
  try {
    const dir = await getDir(parts.join("/"), false);
    await dir.removeEntry(name, { recursive });
    return true;
  } catch (err) {
    if (err && err.name === "NotFoundError") return false;
    throw err;
  }
}

export async function list(path) {
  const out = [];
  try {
    const dir = await getDir(path, false);
    for await (const [name, handle] of dir.entries()) {
      out.push({ name, kind: handle.kind, handle });
    }
  } catch (err) {
    if (err && err.name === "NotFoundError") return out;
    throw err;
  }
  return out;
}

// Walk a directory tree; calls visit(fileHandle, pathParts) for every file.
export async function walk(dirHandle, visit, parts = []) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "directory") await walk(handle, visit, [...parts, name]);
    else await visit(handle, [...parts, name], dirHandle);
  }
}

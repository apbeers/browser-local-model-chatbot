// Memory and crash timeline, stored only on this device, one file per day:
//   app/timeline/YYYY-MM-DD.jsonl
// Lines:
//   {t, e: "mem", w (window id), model, label, gpuMB, jsMB, state}
//     written when GPU memory changes by 16 MB+, the model state changes, or
//     at least every 30 s while a model is loaded
//   {t, e: "crash", kind, msg, model, label, gpuMB}
//     out-of-memory / GPU lost, failed loads, page errors, startup failures
// The dashboard draws these together with the usage log (what you were doing).
// Kept for 30 days.
import { readText, writeText, list, remove } from "./opfs.js";
import { getSettings } from "./retention.js";

const DIR = "app/timeline";
const KEEP_DAYS = 30;
let buffer = [];
let timer = null;
let last = null; // last mem sample written by this window

const dayFile = (t) => `${DIR}/${new Date(t).toISOString().slice(0, 10)}.jsonl`;

function push(line) {
  buffer.push(line);
  clearTimeout(timer);
  timer = setTimeout(flush, 1000);
}

// Writes run one at a time: each appends to the file it just read, so two at
// once would lose lines.
// Other windows append to the same file too, so a Web Lock serializes writes
// across every open window of the app (falls back to this window only).
let writing = Promise.resolve();
const locked = (fn) => (navigator.locks ? navigator.locks.request("timeline-write", fn) : fn());
export function flush() {
  writing = writing.then(() => locked(flushNow), () => locked(flushNow));
  return writing;
}

async function flushNow() {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  if ((await getSettings()).timelineLog === false) return;
  const byFile = {};
  for (const l of batch) (byFile[dayFile(l.t)] ||= []).push(JSON.stringify(l));
  for (const [file, lines] of Object.entries(byFile)) {
    const prev = (await readText(file)) || "";
    await writeText(file, prev + lines.join("\n") + "\n");
  }
}

function jsMB() {
  const m = performance.memory;
  return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
}

// Called by the engine whenever its GPU memory or state changes.
export function sampleMemory(llm, { force = false } = {}) {
  const gpuMB = Math.round(((llm.gpu && llm.gpu.bytes) || 0) / 1048576);
  const now = Date.now();
  const s = { t: now, e: "mem", w: llm.id.slice(0, 8), model: llm.modelId || null, label: llm.model && llm.modelId ? llm.model.label : null, gpuMB, jsMB: jsMB(), state: llm.state };
  const changed = !last || Math.abs(gpuMB - last.gpuMB) >= 16 || s.model !== last.model || s.state !== last.state || now - last.t >= 30000;
  if (!force && !changed) return;
  last = s;
  push(s);
  // Model loads/unloads are written right away so other windows' timelines see them.
  if (!last || s.state === "ready" || s.state === "idle" || s.state === "error") flush();
}

export function logCrash(kind, msg, llm) {
  push({
    t: Date.now(),
    e: "crash",
    kind,
    msg: String(msg || "").slice(0, 300),
    model: llm && llm.modelId,
    label: llm && llm.model ? llm.model.label : null,
    gpuMB: llm && llm.gpu ? Math.round(llm.gpu.bytes / 1048576) : null,
  });
  flush();
}

export async function read({ from = 0, to = Date.now() } = {}) {
  await flush();
  const out = [];
  for (const e of await list(DIR)) {
    if (!e.name.endsWith(".jsonl")) continue;
    const day = Date.parse(e.name.slice(0, 10));
    if (day + 86400000 < from || day > to) continue;
    for (const line of ((await readText(`${DIR}/${e.name}`)) || "").split("\n")) {
      if (!line) continue;
      try {
        const l = JSON.parse(line);
        if (l.t >= from && l.t <= to) out.push(l);
      } catch {
        /* skip */
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export async function lastCrash() {
  const all = await read({ from: Date.now() - KEEP_DAYS * 86400000 });
  return all.filter((l) => l.e === "crash").pop() || null;
}

export async function clear() {
  buffer = [];
  await remove(DIR, true);
}

async function prune() {
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (const e of await list(DIR)) if (e.name.endsWith(".jsonl") && Date.parse(e.name.slice(0, 10)) < cutoff) await remove(`${DIR}/${e.name}`);
}

// Hooks: page errors count as crashes; keep a sample every 30 s while a model is loaded.
export function attach(llm) {
  prune().catch(() => {});
  addEventListener("error", (e) => logCrash("page-error", `${e.message || "error"}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}`, llm));
  addEventListener("unhandledrejection", (e) => logCrash("page-error", e.reason && e.reason.message ? e.reason.message : e.reason, llm));
  setInterval(() => llm.modelId && sampleMemory(llm), 30000);
  addEventListener("pagehide", () => flush());
  addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

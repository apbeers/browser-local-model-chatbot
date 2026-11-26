// Session stats: one JSON file per model session in OPFS (app/stats/sessions/<id>.json).
// A "session" starts when a model load begins and ends when the model is
// unloaded / switched / the page closes. Every generation is appended and the
// file is rewritten as the session runs, so the dashboard can query it at any
// time and nothing is lost if the tab dies.

import { readJSON, writeJSON, list, remove } from "./opfs.js";
import { getDeviceInfo, getDeviceIdentity, getBattery, memorySnapshot } from "./device.js";

export const APP_VERSION = "1.0.0";
export const EXPORT_FORMAT = "browser-llm-bench/v1";
const DIR = "app/stats/sessions";

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function phaseOf(text) {
  if (/Fetching param|fetch/i.test(text)) return "download";
  if (/Loading model from cache/i.test(text)) return "cacheLoad";
  if (/shader|pipeline/i.test(text)) return "shaders";
  return "other";
}

export class Session {
  constructor(record) {
    this.r = record;
    this._saveTimer = null;
    this._phaseStart = {};
  }

  static async start({ model, webllmVersion, cachedBefore }) {
    const [device, identity, battery] = await Promise.all([getDeviceInfo(), getDeviceIdentity(), getBattery()]);
    const r = {
      format: EXPORT_FORMAT,
      id: uid(),
      appVersion: APP_VERSION,
      webllmVersion,
      deviceId: identity.id,
      deviceLabel: identity.label,
      startedAt: Date.now(),
      endedAt: null,
      lastActiveAt: Date.now(),
      status: "loading", // loading | ready | load-failed | ended
      model: {
        id: model.id,
        label: model.label,
        source: model.hfRepo || model.host || null,
        params: model.params,
        quant: model.quant,
        bytes: model.bytes,
        vramMB: model.vramMB,
        contextWindow: model.contextWindow,
      },
      device,
      batteryStart: battery,
      load: {
        cachedBefore: cachedBefore, // fraction 0..1 of model bytes already in OPFS
        totalMs: null,
        phases: {}, // download/cacheLoad/shaders/other -> ms
        downloadBytes: Math.round(model.bytes * (1 - (cachedBefore || 0))),
        error: null,
      },
      generations: [],
      errors: [],
      memory: memorySnapshot(),
    };
    const s = new Session(r);
    s._loadStart = performance.now();
    s._lastPhase = null;
    s._lastPhaseT = s._loadStart;
    await s.saveNow();
    return s;
  }

  get id() {
    return this.r.id;
  }

  onProgress(report) {
    const now = performance.now();
    const phase = phaseOf(report.text || "");
    if (this._lastPhase) {
      this.r.load.phases[this._lastPhase] = (this.r.load.phases[this._lastPhase] || 0) + (now - this._lastPhaseT);
    }
    this._lastPhase = phase;
    this._lastPhaseT = now;
  }

  async loaded() {
    const now = performance.now();
    if (this._lastPhase) {
      this.r.load.phases[this._lastPhase] = (this.r.load.phases[this._lastPhase] || 0) + (now - this._lastPhaseT);
    }
    for (const k of Object.keys(this.r.load.phases)) this.r.load.phases[k] = Math.round(this.r.load.phases[k]);
    this.r.load.totalMs = Math.round(now - this._loadStart);
    const dl = this.r.load.phases.download;
    if (dl && this.r.load.downloadBytes > 0) {
      this.r.load.downloadMBps = +(this.r.load.downloadBytes / 1048576 / (dl / 1000)).toFixed(2);
    }
    this.r.status = "ready";
    this.r.memory = memorySnapshot();
    await this.saveNow();
  }

  async loadFailed(err) {
    this.r.status = "load-failed";
    this.r.load.totalMs = Math.round(performance.now() - this._loadStart);
    this.r.load.error = errText(err);
    this.r.endedAt = Date.now();
    await this.saveNow();
  }

  async addGeneration(g) {
    g.battery = await getBattery();
    g.memory = memorySnapshot();
    this.r.generations.push(g);
    this.r.lastActiveAt = Date.now();
    await this.saveNow();
  }

  async addError(kind, err) {
    this.r.errors.push({ at: Date.now(), kind, message: errText(err) });
    this.r.lastActiveAt = Date.now();
    await this.saveNow();
  }

  async end() {
    if (this.r.endedAt) return;
    this.r.endedAt = Date.now();
    if (this.r.status === "ready" || this.r.status === "loading") this.r.status = "ended";
    this.r.batteryEnd = await getBattery();
    await this.saveNow();
  }

  // Best-effort synchronous-ish flush for pagehide.
  endSoon() {
    if (this.r.endedAt) return;
    this.r.endedAt = Date.now();
    if (this.r.status === "ready" || this.r.status === "loading") this.r.status = "ended";
    this.saveNow();
  }

  summary() {
    return summarize(this.r.generations);
  }

  saveNow() {
    return writeJSON(`${DIR}/${this.r.id}.json`, this.r).catch((e) => console.warn("stats save failed", e));
  }
}

export function errText(err) {
  if (!err) return "unknown error";
  return String(err.message || err).slice(0, 500);
}

// ---------- aggregation helpers ----------

export function median(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function percentile(arr, p) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
  return a[idx];
}

export function mean(arr) {
  const a = arr.filter((x) => Number.isFinite(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

export function summarize(gens) {
  const ok = gens.filter((g) => !g.error);
  const completion = ok.reduce((s, g) => s + (g.completionTokens || 0), 0);
  const prompt = ok.reduce((s, g) => s + (g.promptTokens || 0), 0);
  const decodeMs = ok.reduce((s, g) => s + (g.decodeMs || 0), 0);
  return {
    generations: gens.length,
    failed: gens.length - ok.length,
    completionTokens: completion,
    promptTokens: prompt,
    decodeTpsMedian: median(ok.map((g) => g.decodeTps)),
    decodeTpsOverall: decodeMs > 0 ? completion / (decodeMs / 1000) : null,
    prefillTpsMedian: median(ok.map((g) => g.prefillTps)),
    ttftMedianMs: median(ok.map((g) => g.ttftMs)),
    maxContext: Math.max(0, ...ok.map((g) => g.contextTokens || 0)),
  };
}

// ---------- persistence ----------

export async function loadAllSessions() {
  const entries = await list(DIR);
  const out = [];
  await Promise.all(
    entries
      .filter((e) => e.kind === "file" && e.name.endsWith(".json"))
      .map(async (e) => {
        const r = await readJSON(`${DIR}/${e.name}`);
        if (r && r.id) out.push(r);
      }),
  );
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

export async function deleteSession(id) {
  await remove(`${DIR}/${id}.json`);
}

export async function deleteAllSessions(filter) {
  const all = await loadAllSessions();
  for (const s of all) if (!filter || filter(s)) await deleteSession(s.id);
}

export async function exportSessions(sessions) {
  const identity = await getDeviceIdentity();
  return {
    format: EXPORT_FORMAT,
    exportedAt: Date.now(),
    appVersion: APP_VERSION,
    exportedBy: identity,
    sessions,
  };
}

export async function importBundle(json) {
  const sessions = Array.isArray(json) ? json : json && Array.isArray(json.sessions) ? json.sessions : null;
  if (!sessions) throw new Error("Not a stats export file");
  const existing = new Set((await list(DIR)).map((e) => e.name.replace(/\.json$/, "")));
  let added = 0;
  let skipped = 0;
  for (const s of sessions) {
    if (!s || !s.id || !s.model || !Array.isArray(s.generations)) {
      skipped++;
      continue;
    }
    if (existing.has(s.id)) {
      skipped++;
      continue;
    }
    s.importedAt = s.importedAt || Date.now();
    await writeJSON(`${DIR}/${s.id}.json`, s);
    added++;
  }
  return { added, skipped };
}

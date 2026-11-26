// The `app` object: the one stable interface between the UI layer (js/ui/,
// css/ — customizable in Studio) and the core services (js/core/ — locked).
// UI code should only talk to the core through this object.
// See docs/API.md for every method with examples.
//
//   import { app } from "../core/api.js";   // from a file in js/ui/
//   await app.init();                       // once, at startup
//   app.ready();                            // tell the startup watchdog the UI works
import { APP_VERSION, API_VERSION } from "./version.js";
import { LLM } from "./engine.js";
import * as chats from "./chats.js";
import * as projects from "./projects.js";
import * as statsMod from "./stats.js";
import * as models from "./models.js";
import * as retention from "./retention.js";
import * as themes from "./themes.js";
import * as variants from "./variants.js";
import * as builder from "./builder.js";
import * as benchmark from "./benchmark.js";
import * as appsMod from "./apps.js";
import * as runtime from "./app-runtime.js";
import * as agent from "./agent.js";
import * as pins from "./pins.js";
import * as tools from "./tools.js";
import * as usage from "./usage.js";
import * as storage from "./storage.js";
import * as memory from "./memory.js";
import * as install from "./install.js";
import * as device from "./device.js";
import { findModel, GROUP_LABELS } from "./catalog.js";
import { opfsAvailable, readJSON, writeJSON } from "./opfs.js";

const bus = new EventTarget();
const llm = new LLM();

export const app = {
  appVersion: APP_VERSION,
  apiVersion: API_VERSION,
  /** WebLLM wrapper: load(id, {contextWindow}), generate(messages, opts), interrupt(), unload(); fires "state", "progress", "loaded", "generation", "error". */
  llm,
  /** Model list after init(): {quick: [...], more: [...], all: [...]} */
  catalog: null,
  /** WebGPU adapter info after init(): {available, shaderF16, vendor, ...} */
  gpu: null,
  /** Latest scan of saved models (see refreshModels). */
  scan: null,

  chats,
  projects,
  stats: statsMod,
  models: { ...models, findModel, GROUP_LABELS },
  settings: { get: retention.getSettings, set: retention.setSetting, AUTO_DELETE_OPTIONS: retention.AUTO_DELETE_OPTIONS, daysLeft: retention.daysLeft, getUsage: retention.getUsage },
  themes,
  variants,
  builder,
  benchmark,
  /** Studio apps: storage (listApps, createApp, readApp, saveApp, drafts, history) plus
   *  mount(container, {appId, html, onLog, onNotify, onLoad}) to run one sandboxed, and
   *  check(html) for a syntax check. */
  apps: {
    ...appsMod,
    check: runtime.checkAppHtml,
    compose: runtime.composeDocument,
    mount(container, opts) {
      return runtime.mountApp(container, { ...opts, llm, theme: themes.appTheme, ensureModel: () => app.ensureChatModel(), tools: app.appTools || null });
    },
  },
  agent,
  /** Home Screen pins for Studio apps: createPin(appInfo, html) -> URL to open, isPinned(id), removePin(id). */
  pins,
  /** Tools for chats: TOOLS, available(mode), callTool(name, input), runToolLoop(llm, history, {mode, onStep}). */
  tools,
  /** Tools offered to Studio apps (public ones only: no chats or notes). */
  appTools: tools.appTools("web"),
  /** Usage log (device only): log(event, details), readEvents(), summarize(), clear(), labelChat(llm, chat). */
  usage,
  /** Storage manager: listDir(path), dirSize, readForView, removePath, listCaches, listCacheEntries, readCacheEntry, deleteCache. */
  storage,
  /** GPU memory sharing between windows: budgetMB(), estimateMB(model, ctx), loadedElsewhere(). */
  memory,
  install,
  device,
  opfsAvailable,

  // ---- events: app.on("chats-changed", fn), app.emit("chats-changed") ----
  on(type, fn) {
    const h = (e) => fn(e.detail);
    bus.addEventListener(type, h);
    return () => bus.removeEventListener(type, h);
  },
  emit(type, detail) {
    bus.dispatchEvent(new CustomEvent(type, { detail }));
  },

  async init() {
    install.initInstall();
    usage.attach(app);
    themes.restoreTheme().catch(() => {});
    try {
      app.catalog = await llm.init();
    } catch (err) {
      app.catalogError = err;
    }
    app.gpu = await device.getGPUInfo();
    await app.runAutoDelete();
    await app.refreshModels();
    setInterval(() => app.runAutoDelete(), 6 * 3600000);
    return app;
  },

  /** Rescans saved models in OPFS and fires "models-changed". */
  async refreshModels() {
    if (!app.catalog || !opfsAvailable()) return null;
    try {
      app.scan = await models.scanModelCache(app.catalog);
    } catch {
      /* ignore */
    }
    app.emit("models-changed", app.scan);
    return app.scan;
  },

  /** Can this device's GPU run model m? */
  modelUsable(m) {
    if (!app.gpu || !app.gpu.available) return false;
    return !(m.requiresF16 && !app.gpu.shaderF16);
  },

  /** True when every file of model m is saved, so it loads offline. */
  isSaved(m) {
    return models.cacheInfo(m, app.scan).complete;
  },

  /** Deletes models and chats that passed their auto-delete window. Returns {models, chats} deleted. */
  async runAutoDelete() {
    const out = { models: [], chats: [] };
    if (!opfsAvailable()) return out;
    try {
      if (app.catalog) out.models = await retention.runAutoDelete(app.catalog, { keepId: llm.modelId });
      const s = await retention.getSettings();
      const list = await projects.listProjects();
      const daysFor = (pid) => {
        const p = pid && list.find((x) => x.id === pid);
        return p && p.autoDeleteDays != null ? p.autoDeleteDays : s.chatAutoDeleteDays;
      };
      out.chats = await chats.runChatAutoDelete(daysFor, { keepId: app.currentChatId });
    } catch (e) {
      console.warn("auto-delete failed", e);
    }
    if (out.models.length) await app.refreshModels();
    if (out.chats.length) app.emit("chats-changed");
    if (out.models.length || out.chats.length) app.emit("auto-deleted", out);
    return out;
  },

  /** Logs one failed session per browser that has no WebGPU, so the dashboard shows devices that can't run models. */
  async recordUnsupportedOnce() {
    if (!opfsAvailable() || (await readJSON("app/unsupported-recorded.json"))) return;
    try {
      const s = await statsMod.Session.start({ model: { id: "(no WebGPU)", label: "No WebGPU", bytes: 0, vramMB: 0, contextWindow: 0 }, webllmVersion: app.catalog ? app.catalog.webllm : "", cachedBefore: 0 });
      await s.loadFailed(new Error("WebGPU unavailable: " + ((app.gpu && app.gpu.reason) || "")));
      await writeJSON("app/unsupported-recorded.json", { at: Date.now() });
    } catch {
      /* ignore */
    }
  },

  /** Makes sure some model is loaded (the one picked in the chat dropdown). */
  async ensureChatModel() {
    if (llm.modelId) return true;
    if (!app.gpu || !app.gpu.available || !app.catalog) return false;
    let id = null;
    try {
      id = localStorage.getItem("model");
    } catch {
      /* ignore */
    }
    const m = (id && findModel(app.catalog, id)) || app.catalog.quick.find((x) => app.isSaved(x) && app.modelUsable(x)) || app.catalog.quick.find((x) => app.modelUsable(x));
    if (!m) return false;
    return app.loadModel ? app.loadModel(m.id) : (await llm.load(m.id), true);
  },

  /** Call once the UI has rendered. Stops the startup watchdog in index.html. */
  ready() {
    window.__appReady = true;
    if (window.__bootOk) window.__bootOk();
  },
};

window.app = app;

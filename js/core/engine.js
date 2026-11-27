// Thin wrapper around WebLLM running in a module worker. Handles model loading,
// streaming chat with detailed timing, and the stats session lifecycle.

import { loadCatalog, buildAppConfig, findModel } from "./catalog.js";
import { Session, errText } from "./stats.js";
import { scanModelCache, cacheInfo } from "./models.js";
import { touchModel } from "./retention.js";
import * as memory from "./memory.js";
import * as timeline from "./timeline.js";

// Messages that mean the GPU dropped the model (usually out of memory).
export const GPU_LOST = /device (was )?lost|GPUDevice|Instance (reference|dropped)|external Instance|already been disposed|out of memory|OutOfMemory|allocation failed/i;

const WINDOW = 16; // tokens per throughput window (for throttling curves)

let webllmPromise = null;
function webllm() {
  if (!webllmPromise) webllmPromise = import("../../vendor/web-llm/index.js");
  return webllmPromise;
}

export class LLM extends EventTarget {
  constructor() {
    super();
    this.catalog = null;
    this.engine = null;
    this.worker = null;
    this.modelId = null;
    this.model = null;
    this.session = null;
    this.state = "idle"; // idle | loading | ready | generating | error
    this.genQueue = Promise.resolve(); // replies run one at a time
    this.switching = false; // true while load() replaces the model
    this.loadProgress = null;
    this.lastHistoryKey = null;
    this.kvTokens = 0;
    this.id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
    this.gpu = { bytes: 0, peak: 0, buffers: 0 };
    this.lastUsed = 0;
    memory.attach(this); // share GPU memory with other open windows
    memory.unloadWhenHidden(this);
    timeline.attach(this); // memory/crash timeline for the stats dashboard
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(s) {
    this.state = s;
    this.emit("state", s);
    memory.announce(this);
    timeline.sampleMemory(this);
  }

  async init() {
    this.catalog = await loadCatalog();
    return this.catalog;
  }

  // opts.contextWindow overrides the model's default context size (tokens).
  async load(modelId, opts = {}) {
    if (!this.catalog) await this.init();
    const model = findModel(this.catalog, modelId);
    if (!model) throw new Error("Unknown model " + modelId);
    if (this.state === "loading") throw new Error("A model is already loading");
    // A reply still running (a chat answer, the chat-topic labeler, an app's request)
    // would be torn down by the reload and fail with "already been disposed", which
    // looks like the GPU running out of memory. Stop it and wait for it to end first.
    this.switching = true;
    if (this.state === "generating") {
      await this.interrupt();
      for (let i = 0; i < 200 && this.state === "generating"; i++) await new Promise((r) => setTimeout(r, 50));
    }
    await this.genQueue;
    if (this.session) {
      await this.session.end();
      this.session = null;
    }
    // Switching models reuses the engine: WebLLM unloads the old model and frees
    // its GPU buffers right away. (A fresh worker would free them only when the
    // browser cleans up the old one, which Safari can delay, briefly holding two models.)
    this.modelId = null;
    this.setState("loading");
    this.modelId = null;
    this.model = model;
    this.loadProgress = { progress: 0, text: "Starting…" };
    this.emit("progress", this.loadProgress);

    let cachedBefore = 0;
    let complete = false;
    try {
      const info = cacheInfo(model, await scanModelCache(this.catalog));
      complete = info.complete;
      cachedBefore = complete ? 1 : info.fraction;
    } catch {
      /* ignore */
    }
    const lib = await webllm();
    const session = await Session.start({ model, webllmVersion: this.catalog.webllm, cachedBefore });
    this.session = session;
    if (!complete) {
      // Fail fast with a readable message instead of WebLLM's bare "Load failed".
      let res = null;
      try {
        if (navigator.onLine === false) throw new Error("offline");
        res = await fetch(model.modelUrl + "mlc-chat-config.json", { cache: "no-store" });
      } catch {
        /* network or CORS failure */
      }
      if (!res || !res.ok) {
        const err = new Error(
          navigator.onLine === false
            ? `You're offline and ${model.label} isn't fully downloaded yet. Connect once to download it; after that it works offline.`
            : `Can't reach Hugging Face to download ${model.label} (${res ? "HTTP " + res.status : "network error"}). Check your connection and try again.`,
        );
        await session.loadFailed(err);
        this.session = null;
        this.switching = false;
        this.setState("error");
        this.emit("error", err);
        throw err;
      }
    }
    const appConfig = buildAppConfig(this.catalog, lib.prebuiltAppConfig);
    // Ask idle models in other windows to unload if this one wouldn't fit.
    const freed = await memory.makeRoom(this, model, opts.contextWindow || model.contextWindow);
    if (freed.length) this.emit("freed-memory", { models: freed });
    let chatOpts;
    if (opts.contextWindow) chatOpts = { context_window_size: opts.contextWindow };
    const contextWindow = opts.contextWindow || model.contextWindow;
    session.r.model.contextWindow = contextWindow;
    const onProgress = (report) => {
      session.onProgress(report);
      this.loadProgress = report;
      this.emit("progress", report);
    };
    try {
      if (!this.engine) {
        this.worker = new Worker(new URL("./llm-worker.js", import.meta.url), { type: "module" });
        // Exact GPU memory: the worker counts every GPU buffer and reports here.
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => this._gpuReport(e.data);
        this.worker.postMessage({ __gpuMemPort: ch.port2 }, [ch.port2]);
        this.engine = await lib.CreateWebWorkerMLCEngine(
          this.worker,
          modelId,
          { appConfig, initProgressCallback: onProgress },
          chatOpts,
        );
      } else {
        this.engine.setInitProgressCallback(onProgress);
        await this.engine.reload(modelId, chatOpts);
      }
      await session.loaded();
      // Measured GPU memory after loading (reports arrive a moment later).
      setTimeout(() => {
        session.r.load.gpuMB = Math.round(this.gpu.bytes / 1048576);
        session.saveNow();
      }, 800);
      touchModel(modelId).catch(() => {});
      this.modelId = modelId;
      this.contextWindow = contextWindow;
      this.lastHistoryKey = null;
      this.kvTokens = 0;
      this.lastUsed = Date.now();
      this.switching = false;
      this.setState("ready");
      this.emit("loaded", { model, session });
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error(errText(caught));
      await session.loadFailed(err);
      this.switching = false;
      const lost = GPU_LOST.test(errText(err));
      timeline.logCrash(lost ? "out-of-memory" : "load-failed", `Loading ${model.label}: ${errText(err)}`, this);
      if (lost) {
        err.gpuLost = true;
        this.emit("gpu-lost", { model, message: errText(err), during: "load", contextWindow });
      }
      this.session = null;
      this.modelId = null;
      // A failed reload can leave the engine unusable; start fresh next time.
      this.destroyWorker();
      this.setState("error");
      this.emit("error", err);
      throw err;
    }
  }

  destroyWorker() {
    try {
      if (this.worker) this.worker.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
    this.engine = null;
    this._gpuReport({ bytes: 0, peak: 0, buffers: 0 });
  }

  // {bytes, peak, buffers}: GPU memory used by this window's engine, measured in its worker.
  _gpuReport(d) {
    this.gpu = d;
    this.emit("gpu-memory", d);
    timeline.sampleMemory(this);
    clearTimeout(this._gpuAnnounce);
    this._gpuAnnounce = setTimeout(() => memory.announce(this), 500);
  }

  // opts.reason: shown to the user when the model was unloaded automatically.
  async unload(opts = {}) {
    if (this.session) await this.session.end();
    this.session = null;
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        /* ignore */
      }
    }
    this.destroyWorker();
    const was = this.model;
    this.modelId = null;
    this.model = null;
    this.setState("idle");
    if (was) this.emit("unloaded", { model: was, reason: opts.reason || "by you" });
    if (opts.reason && was) this.emit("auto-unloaded", { model: was, reason: opts.reason });
  }

  async interrupt() {
    if (this.engine && this.state === "generating") {
      this.interrupted = true;
      await this.engine.interruptGenerate();
    }
  }

  // messages: [{role, content}] (OpenAI format). onToken(fullText) is called as text streams in.
  // opts.request: extra WebLLM request fields (temperature, max_tokens, response_format, seed…).
  // opts.kind: tag stored with the stats record ("chat", "benchmark", "builder-code", …).
  generate(messages, opts = {}) {
    const run = this.genQueue.then(() => this._generate(messages, opts));
    this.genQueue = run.catch(() => {});
    return run;
  }

  async _generate(messages, { onToken, conversationId, projectId, maxTokens, request, kind, meta } = {}) {
    if (this.switching) throw Object.assign(new Error("Stopped: another model is loading"), { superseded: true });
    if (!this.engine || !this.modelId) throw new Error("No model loaded");
    this.lastUsed = Date.now();
    if (this.worker) this.worker.postMessage({ __gpuMemResetPeak: true }); // measure this reply's peak
    this.setState("generating");
    this.interrupted = false;
    let msgs = messages;
    let dropped = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this._generateOnce(msgs, { onToken, conversationId, projectId, maxTokens, request, kind, meta });
        result.droppedMessages = dropped;
        this.setState("ready");
        return result;
      } catch (caught) {
        // WebLLM can reject with a plain string; make it a real Error so it can be tagged.
        const err = caught instanceof Error ? caught : new Error(errText(caught));
        const msg = errText(err);
        const ctxErr = /context ?window|exceed/i.test(msg);
        if (ctxErr && attempt < 6 && msgs.length > 2) {
          // Drop the oldest non-system turn and retry.
          const firstNonSystem = msgs.findIndex((m) => m.role !== "system");
          msgs = msgs.filter((_, i) => i !== firstNonSystem);
          dropped++;
          continue;
        }
        if (this.session) await this.session.addError("generate", err);
        // When the GPU drops the model (often out of memory on phones), WebLLM tears it
        // down and the running request fails with "...has already been disposed".
        if (this.switching) {
          // Torn down because another model (or context size) is loading: not a crash.
          err.superseded = true;
          if (this.state === "generating") this.setState("ready");
        } else if (GPU_LOST.test(msg)) {
          err.gpuLost = true;
          timeline.logCrash("out-of-memory", `${this.model ? this.model.label : "Model"} while replying (${kind || "chat"}): ${msg}`, this);
          this.emit("gpu-lost", { model: this.model, message: msg, during: kind || "chat", contextWindow: this.contextWindow });
          this.destroyWorker();
          this.modelId = null;
          this.setState("error");
        } else {
          timeline.logCrash("reply-failed", `${this.model ? this.model.label : "Model"}: ${msg}`, this);
          this.setState("ready");
        }
        throw err;
      }
    }
  }

  async _generateOnce(messages, { onToken, conversationId, projectId, maxTokens, request, kind, meta }) {
    const historyKey = JSON.stringify(messages.slice(0, -1));
    const reusedKV = this.lastHistoryKey !== null && historyKey === this.lastHistoryKey;
    const t0 = performance.now();
    const startedAt = Date.now();
    const req = {
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (maxTokens) req.max_tokens = maxTokens;
    if (this.model.sampling) Object.assign(req, this.model.sampling);
    if (request) Object.assign(req, request);
    const stream = await this.engine.chat.completions.create(req);
    let text = "";
    let tFirst = null;
    let chunks = 0;
    let lastWinT = null;
    const windows = [];
    let usage = null;
    let finishReason = null;
    for await (const chunk of stream) {
      const choice = chunk.choices && chunk.choices[0];
      if (choice) {
        const delta = (choice.delta && choice.delta.content) || "";
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const now = performance.now();
        if (tFirst === null) {
          tFirst = now;
          lastWinT = now;
        }
        chunks++;
        if (chunks % WINDOW === 0) {
          windows.push(+(WINDOW / ((now - lastWinT) / 1000)).toFixed(2));
          lastWinT = now;
        }
        if (delta) {
          text += delta;
          if (onToken) onToken(text);
        }
      }
      if (chunk.usage) usage = chunk.usage;
    }
    const tEnd = performance.now();
    const extra = (usage && usage.extra) || {};
    const completionTokens = usage ? usage.completion_tokens : chunks;
    const promptTokens = usage ? usage.prompt_tokens : null;
    const decodeMs = tFirst !== null ? tEnd - tFirst : 0;
    this.kvTokens = (reusedKV ? this.kvTokens : 0) + (promptTokens || 0) + (completionTokens || 0);
    this.lastHistoryKey = JSON.stringify([...messages, { role: "assistant", content: text }]);

    const gen = {
      at: startedAt,
      conversationId: conversationId || null,
      messagesSent: messages.length,
      promptTokens,
      completionTokens,
      reusedKV,
      contextTokens: this.kvTokens,
      contextWindow: this.contextWindow || this.model.contextWindow,
      ttftMs: tFirst !== null ? Math.round(tFirst - t0) : null,
      e2eMs: Math.round(tEnd - t0),
      decodeMs: Math.round(decodeMs),
      // Engine-reported (GPU-side) numbers
      prefillTps: Number.isFinite(extra.prefill_tokens_per_s) ? +extra.prefill_tokens_per_s.toFixed(2) : null,
      decodeTps: Number.isFinite(extra.decode_tokens_per_s) ? +extra.decode_tokens_per_s.toFixed(2) : null,
      engineTtftMs: Number.isFinite(extra.time_to_first_token_s) ? Math.round(extra.time_to_first_token_s * 1000) : null,
      timePerTokenMs: Number.isFinite(extra.time_per_output_token_s) ? +(extra.time_per_output_token_s * 1000).toFixed(2) : null,
      // Client-observed throughput including worker messaging overhead
      wallDecodeTps: decodeMs > 0 && completionTokens > 1 ? +((completionTokens - 1) / (decodeMs / 1000)).toFixed(2) : null,
      windowTps: windows,
      finishReason: this.interrupted ? "interrupted" : finishReason,
      maxTokens: req.max_tokens || null,
      kind: kind || "chat",
      gpuMB: Math.round(this.gpu.bytes / 1048576),
      gpuPeakMB: Math.round(this.gpu.peak / 1048576),
      projectId: projectId || null,
      temperature: req.temperature ?? null,
    };
    if (meta) Object.assign(gen, meta);
    if (this.session) await this.session.addGeneration(gen);
    touchModel(this.modelId).catch(() => {});
    this.emit("generation", gen);
    return { text, gen };
  }
}

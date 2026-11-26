// Thin wrapper around WebLLM running in a module worker. Handles model loading,
// streaming chat with detailed timing, and the stats session lifecycle.

import { loadCatalog, buildAppConfig, findModel } from "./catalog.js";
import { Session, errText } from "./stats.js";
import { scanModelCache, cacheInfo } from "./models.js";
import { touchModel } from "./retention.js";

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
    this.loadProgress = null;
    this.lastHistoryKey = null;
    this.kvTokens = 0;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(s) {
    this.state = s;
    this.emit("state", s);
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
    if (this.session) {
      await this.session.end();
      this.session = null;
    }
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
        this.setState("error");
        this.emit("error", err);
        throw err;
      }
    }
    const appConfig = buildAppConfig(this.catalog, lib.prebuiltAppConfig);
    const chatOpts = opts.contextWindow ? { context_window_size: opts.contextWindow } : undefined;
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
      touchModel(modelId).catch(() => {});
      this.modelId = modelId;
      this.contextWindow = contextWindow;
      this.lastHistoryKey = null;
      this.kvTokens = 0;
      this.setState("ready");
      this.emit("loaded", { model, session });
    } catch (err) {
      await session.loadFailed(err);
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
  }

  async unload() {
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
    this.modelId = null;
    this.model = null;
    this.setState("idle");
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
  async generate(messages, { onToken, conversationId, projectId, maxTokens, request, kind, meta } = {}) {
    if (!this.engine || !this.modelId) throw new Error("No model loaded");
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
      } catch (err) {
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
        if (/device (was )?lost|GPUDevice|Instance (reference|dropped)|external Instance/i.test(msg)) {
          this.destroyWorker();
          this.modelId = null;
          this.setState("error");
        } else {
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

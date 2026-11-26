// The row of live numbers above the chat: decode/prefill speed, time to first
// token, context used, session totals, load time and GPU.
import { app } from "../../core/api.js";
import { state, $ } from "../state.js";
import { h, fmtNum, fmtMs } from "../dom.js";

function stat(label, valueHtml, sub, cls) {
  return h(
    "div",
    { class: "stat" + (cls ? " " + cls : "") },
    h("div", { class: "stat-label" }, label),
    h("div", { class: "stat-value", html: valueHtml }),
    sub != null ? h("div", { class: "stat-sub" }, sub) : null,
  );
}

export function renderStats() {
  const strip = $("statsStrip");
  if (!strip) return;
  const llm = app.llm;
  const s = llm.session;
  const gens = s ? s.r.generations : [];
  const sum = s ? s.summary() : null;
  const live = state.live;
  const g = gens[gens.length - 1];
  const tps = live && live.tps ? live.tps : g ? g.decodeTps : null;
  const win = llm.contextWindow || (llm.model ? llm.model.contextWindow : null);
  const used = g ? g.contextTokens : 0;
  const pct = win ? Math.min(100, (used / win) * 100) : 0;
  const load = s && s.r.load.totalMs != null ? s.r.load : null;
  const ctx = stat("Context", `${used || 0}<small> / ${win || "–"}</small>`, null);
  ctx.append(h("div", { class: "ctx-bar" + (pct > 80 ? " warn" : "") }, h("div", { style: `width:${pct}%` })));
  strip.replaceChildren(
    stat(live ? "Decode (live)" : "Decode", `${fmtNum(tps)} <small>tok/s</small>`, sum && sum.decodeTpsMedian ? `median ${fmtNum(sum.decodeTpsMedian)}` : "tokens per second"),
    stat("Prefill", `${fmtNum(g ? g.prefillTps : null, 0)} <small>tok/s</small>`, g && g.promptTokens != null ? `${g.promptTokens} prompt tok` : "prompt processing"),
    stat("First token", fmtMs(g ? g.ttftMs : null), g ? `total ${fmtMs(g.e2eMs)}` : "latency"),
    ctx,
    stat("Session", `${sum ? sum.generations : 0} <small>replies</small>`, sum ? `${sum.completionTokens} tokens out` : "no model loaded", "wide-only"),
    stat(
      "Load",
      fmtMs(load ? load.totalMs : null),
      load ? (load.cachedBefore > 0.97 ? "from storage" : `downloaded ${app.models.fmtBytes(load.downloadBytes)}`) : llm.state === "loading" ? "loading…" : "–",
      "wide-only",
    ),
    stat("GPU", app.gpu && app.gpu.available ? (app.gpu.shaderF16 ? "f16 ✓" : "f32 only") : "none", app.device.gpuLabel(app.gpu), "wide-only"),
  );
}

app.llm.addEventListener("state", renderStats);
app.llm.addEventListener("generation", renderStats);
app.llm.addEventListener("loaded", renderStats);

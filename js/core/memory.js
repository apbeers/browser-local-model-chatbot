// GPU memory coordination between every open copy of the app.
//
// Each tab, pinned app and Studio preview has its own engine. They share one
// GPU, and phones fit only one model at a time. Every engine reports what it
// has loaded on a BroadcastChannel; before loading, an engine asks idle ones
// that were used least recently to unload until the new model fits the budget.
// A model that is generating is never interrupted.
//
// Budget (there's no API for free GPU memory, so it's an estimate):
//   phones/tablets: 2.2 GB    computers: 60% of reported memory, at most 12 GB.

const CH = "llm-gpu-memory";
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CH) : null;
const peers = new Map(); // engine id -> {id, modelId, label, mb, lastUsed, busy, seen}
const waiters = new Map(); // engine id -> resolve() when it reports "unloaded"
let self = null; // this page's engine

const isMobile = () => /Android|iPhone|iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

export function budgetMB() {
  if (isMobile()) return 2200;
  const gb = navigator.deviceMemory || 8; // browsers cap this at 8
  return Math.min(12000, Math.round(gb * 1024 * 0.6) + (gb >= 8 ? 2000 : 0));
}

// GPU memory a model needs: WebLLM's estimate at 4k context, plus the bigger KV cache for longer contexts.
export function estimateMB(model, contextWindow) {
  const base = (model && model.vramMB) || 1500;
  const ctx = contextWindow || (model && model.contextWindow) || 4096;
  return Math.round(base * (1 + 0.12 * Math.max(0, ctx / 4096 - 1)));
}

function info(llm) {
  return {
    id: llm.id,
    modelId: llm.modelId,
    label: llm.model ? llm.model.label : null,
    mb: llm.modelId ? estimateMB(llm.model, llm.contextWindow) : 0,
    lastUsed: llm.lastUsed || 0,
    busy: llm.state === "generating" || llm.state === "loading",
    title: document.title,
  };
}

export function announce(llm) {
  if (channel) channel.postMessage({ type: "state", ...info(llm) });
}

export function attach(llm) {
  self = llm;
  if (!channel) return;
  channel.onmessage = async (e) => {
    const m = e.data || {};
    if (m.type === "hello") announce(llm);
    else if (m.type === "state") {
      if (m.modelId) peers.set(m.id, { ...m, seen: Date.now() });
      else {
        peers.delete(m.id);
        const w = waiters.get(m.id);
        if (w) w();
      }
    } else if (m.type === "unload" && m.target === llm.id) {
      if (llm.state === "generating" || llm.state === "loading") return announce(llm); // busy: keep it
      await llm.unload({ reason: m.reason || "Unloaded to free GPU memory for another window." });
    }
  };
  channel.postMessage({ type: "hello" });
  addEventListener("pagehide", () => channel.postMessage({ type: "state", id: llm.id, modelId: null }));
}

// Frees room for `model` by unloading idle engines in other windows, least
// recently used first. Resolves to the list of models it asked to unload.
export async function makeRoom(llm, model, contextWindow) {
  if (!channel) return [];
  channel.postMessage({ type: "hello" });
  await new Promise((r) => setTimeout(r, 150)); // let others report
  const need = estimateMB(model, contextWindow);
  const others = [...peers.values()].filter((p) => p.id !== llm.id && p.modelId && Date.now() - p.seen < 10 * 60000);
  let used = others.reduce((s, p) => s + p.mb, 0);
  const freed = [];
  for (const p of others.sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (used + need <= budgetMB()) break;
    if (p.busy) continue;
    const done = new Promise((r) => {
      waiters.set(p.id, r);
      setTimeout(r, 4000);
    });
    channel.postMessage({ type: "unload", target: p.id, reason: `Unloaded so ${model.label} fits in GPU memory in another window.` });
    await done;
    waiters.delete(p.id);
    peers.delete(p.id);
    used -= p.mb;
    freed.push(p.label);
  }
  return freed;
}

// Phones: unload a model whose window has been in the background a while.
export function unloadWhenHidden(llm, minutes = 2) {
  if (!isMobile()) return;
  let timer = null;
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (document.visibilityState !== "hidden") return;
    timer = setTimeout(() => {
      if (llm.modelId && llm.state === "ready") llm.unload({ reason: "Unloaded while the app was in the background, to save memory." });
    }, minutes * 60000);
  });
}

export const loadedElsewhere = () => [...peers.values()].filter((p) => p.modelId && (!self || p.id !== self.id));

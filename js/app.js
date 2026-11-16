import { LLM } from "./engine.js";
import { renderMarkdown, installCopyHandler } from "./markdown.js";
import { listChats, getChat, saveChat, newChat, deleteChat, renameChat, titleFrom } from "./chats.js";
import { getGPUInfo, gpuLabel, webgpuAvailable } from "./device.js";
import { scanModelCache, cachedFraction, fmtBytes } from "./models.js";
import { opfsAvailable, readJSON, writeJSON } from "./opfs.js";
import { Session } from "./stats.js";
import { h, iconBtn, icons, toast, confirmDialog, promptDialog, fmtNum, fmtMs, relTime } from "./ui.js";
import { renderModelsView } from "./views/models-view.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderSettings, applyTheme } from "./views/settings.js";

const $ = (id) => document.getElementById(id);
const els = {
  app: $("app"),
  sidebar: $("sidebar"),
  scrim: $("scrim"),
  chatList: $("chat-list"),
  messages: $("messages"),
  prompt: $("prompt"),
  composer: $("composer"),
  sendBtn: $("send-btn"),
  modelSelect: $("model-select"),
  loadBtn: $("load-btn"),
  loadbar: $("loadbar"),
  loadText: $("load-text"),
  loadPct: $("load-pct"),
  loadFill: $("load-fill"),
  banner: $("banner"),
  statsStrip: $("stats-strip"),
  statsToggle: $("stats-toggle"),
  title: $("topbar-title"),
  modelBar: $("model-bar"),
  sidebarFoot: $("sidebar-foot"),
};

export const app = {
  llm: new LLM(),
  catalog: null,
  gpu: null,
  scan: null,
  chat: null,
  view: "chat",
  live: null, // live generation stats
  lastGen: null,
};
const llm = app.llm;

function lsGet(k, d = null) {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : v;
  } catch {
    return d;
  }
}
function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

// ---------------- Init ----------------
async function init() {
  applyTheme(lsGet("theme", "system"));
  registerSW();
  bindChrome();
  installCopyHandler(els.messages);

  if (!opfsAvailable()) {
    showBanner("This browser does not support the Origin Private File System, so chats, stats and model downloads cannot be saved.", true);
  }

  try {
    app.catalog = await llm.init();
  } catch (err) {
    showBanner("Could not load the model catalog: " + err.message, true);
  }
  app.gpu = await getGPUInfo();
  if (!webgpuAvailable() || !app.gpu.available) {
    showBanner(
      "WebGPU is not available in this browser (" +
        (app.gpu.reason || "unsupported") +
        "). Use a recent Chrome or Edge, or Safari 26+ on iPhone, iPad or Mac.",
      true,
    );
    recordUnsupported();
  }
  await refreshScan();
  populateModelSelect();
  bindLLMEvents();
  renderStats();
  await renderChatList();
  window.addEventListener("hashchange", route);
  await route();
  updateFoot();
}

async function recordUnsupported() {
  // One record per browser profile so the dashboard shows devices that can't run models.
  const flag = await readJSON("app/unsupported-recorded.json");
  if (flag) return;
  try {
    const s = await Session.start({
      model: { id: "(no WebGPU)", label: "No WebGPU", host: "-", bytes: 0, vramMB: 0, contextWindow: 0 },
      webllmVersion: app.catalog ? app.catalog.webllm : "",
      cachedBefore: 0,
    });
    await s.loadFailed(new Error("WebGPU unavailable: " + (app.gpu.reason || "")));
    await writeJSON("app/unsupported-recorded.json", { at: Date.now() });
  } catch {
    /* ignore */
  }
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed", e));
  // Only an *update* (a new worker replacing an old one) needs a reload hint.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    toast("App updated. Reload to use the new version.", 5000);
  });
}

function bindChrome() {
  $("open-sidebar").onclick = () => setSidebar(true);
  $("close-sidebar").onclick = () => setSidebar(false);
  els.scrim.onclick = () => setSidebar(false);
  $("new-chat").onclick = () => {
    location.hash = "#/chat";
    startNewChat();
    setSidebar(false);
    els.prompt.focus();
  };
  els.statsToggle.onclick = () => {
    const on = els.statsToggle.getAttribute("aria-pressed") !== "true";
    els.statsToggle.setAttribute("aria-pressed", String(on));
    els.statsStrip.classList.toggle("collapsed", !on);
    lsSet("showStats", on ? "1" : "0");
  };
  if (lsGet("showStats", "1") === "0") {
    els.statsToggle.setAttribute("aria-pressed", "false");
    els.statsStrip.classList.add("collapsed");
  }
  els.modelSelect.onchange = () => {
    lsSet("model", els.modelSelect.value);
    updateLoadButton();
  };
  els.loadBtn.onclick = () => loadSelected();
  els.composer.addEventListener("submit", (e) => {
    e.preventDefault();
    if (llm.state === "generating") llm.interrupt();
    else send();
  });
  els.prompt.addEventListener("input", autosize);
  els.prompt.addEventListener("keydown", (e) => {
    const coarse = matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.isComposing) {
      e.preventDefault();
      els.composer.requestSubmit();
    }
  });
  window.addEventListener("pagehide", () => {
    if (llm.session) llm.session.endSoon();
  });
}

function setSidebar(open) {
  els.app.classList.toggle("sidebar-open", open);
  els.scrim.hidden = !open;
}

function autosize() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = Math.min(els.prompt.scrollHeight, window.innerHeight * 0.4) + "px";
}

function showBanner(text, error = false) {
  els.banner.textContent = text;
  els.banner.classList.toggle("error", error);
  els.banner.hidden = false;
}

async function updateFoot() {
  try {
    const e = await navigator.storage.estimate();
    els.sidebarFoot.textContent = `Storage used: ${fmtBytes(e.usage)} of ${fmtBytes(e.quota)}`;
  } catch {
    els.sidebarFoot.textContent = "";
  }
}
app.updateFoot = updateFoot;

// ---------------- Routing ----------------
async function route() {
  const hash = location.hash || "#/chat";
  const [, view, id] = hash.split("/");
  const v = ["chat", "models", "dashboard", "settings"].includes(view) ? view : "chat";
  app.view = v;
  for (const sec of document.querySelectorAll(".view")) sec.hidden = sec.dataset.view !== v;
  for (const a of document.querySelectorAll(".nav a")) a.classList.toggle("active", a.dataset.nav === v);
  els.modelBar.hidden = v !== "chat";
  els.statsToggle.hidden = v !== "chat";
  els.title.textContent = { chat: "Chat", models: "Models", dashboard: "Stats dashboard", settings: "Settings" }[v];
  setSidebar(false);
  if (v === "chat") {
    if (id) {
      if (!app.chat || app.chat.id !== id) await openChat(id);
    } else if (!app.chat) startNewChat();
    els.title.textContent = app.chat && app.chat.messages.length ? app.chat.title : "Chat";
  } else if (v === "models") {
    await renderModelsView($("view-models"), app);
  } else if (v === "dashboard") {
    await renderDashboard($("view-dashboard"), app);
  } else if (v === "settings") {
    await renderSettings($("view-settings"), app);
  }
  highlightChat();
}

// ---------------- Models ----------------
async function refreshScan() {
  if (!app.catalog || !opfsAvailable()) return;
  try {
    app.scan = await scanModelCache(app.catalog);
  } catch (e) {
    console.warn("cache scan failed", e);
  }
}
app.refreshScan = async () => {
  await refreshScan();
  populateModelSelect();
};

function modelUsable(m) {
  if (!app.gpu || !app.gpu.available) return false;
  if (m.requiresF16 && !app.gpu.shaderF16) return false;
  return true;
}
app.modelUsable = modelUsable;

function populateModelSelect() {
  const sel = els.modelSelect;
  sel.innerHTML = "";
  if (!app.catalog) return;
  const saved = lsGet("model");
  let firstUsable = null;
  for (const m of app.catalog.models) {
    const cached = app.scan ? cachedFraction(m, app.scan) > 0.97 : false;
    const usable = modelUsable(m);
    if (usable && !firstUsable) firstUsable = m.id;
    const label = `${m.label} · ${fmtBytes(m.bytes)}${cached ? " · saved" : ""}${usable ? "" : " · needs shader-f16"}`;
    sel.append(h("option", { value: m.id, disabled: !usable && app.gpu && app.gpu.available ? true : null }, label));
  }
  const want = saved && app.catalog.models.some((m) => m.id === saved && modelUsable(m)) ? saved : firstUsable || app.catalog.models[0]?.id;
  if (llm.modelId) sel.value = llm.modelId;
  else if (want) sel.value = want;
  updateLoadButton();
}

function updateLoadButton() {
  const b = els.loadBtn;
  const sel = els.modelSelect.value;
  if (llm.state === "loading") {
    b.textContent = "Loading…";
    b.disabled = true;
  } else if (llm.modelId === sel && (llm.state === "ready" || llm.state === "generating")) {
    b.textContent = "Loaded";
    b.disabled = true;
  } else {
    const m = app.catalog && app.catalog.models.find((x) => x.id === sel);
    const cached = m && app.scan ? cachedFraction(m, app.scan) > 0.97 : false;
    b.textContent = cached ? "Load" : "Download";
    b.disabled = !m || !modelUsable(m) || llm.state === "generating";
  }
  els.modelSelect.disabled = llm.state === "loading" || llm.state === "generating";
}

export async function loadModel(id) {
  els.modelSelect.value = id;
  lsSet("model", id);
  try {
    await llm.load(id);
    toast(`${llm.model.label} is ready`);
  } catch (err) {
    showBanner("Model failed to load: " + (err && err.message ? err.message : err), true);
  }
  await refreshScan();
  populateModelSelect();
  updateFoot();
}
app.loadModel = loadModel;

function loadSelected() {
  els.banner.hidden = !els.banner.classList.contains("error") || els.banner.hidden;
  return loadModel(els.modelSelect.value);
}

function bindLLMEvents() {
  llm.addEventListener("state", () => {
    updateLoadButton();
    updateSendButton();
    els.loadbar.hidden = llm.state !== "loading";
    renderStats();
  });
  llm.addEventListener("progress", (e) => {
    const r = e.detail;
    els.loadbar.hidden = false;
    els.loadText.textContent = r.text || "Loading…";
    const pct = Math.round((r.progress || 0) * 100);
    els.loadPct.textContent = pct + "%";
    els.loadFill.style.width = pct + "%";
    if (app.view === "models") app.onLoadProgress && app.onLoadProgress(r);
  });
  llm.addEventListener("loaded", () => {
    els.banner.hidden = true;
    renderStats();
  });
  llm.addEventListener("generation", (e) => {
    app.lastGen = e.detail;
    renderStats();
  });
}

// ---------------- Chats ----------------
async function renderChatList() {
  const chats = await listChats();
  els.chatList.innerHTML = "";
  if (!chats.length) {
    els.chatList.append(h("li", { class: "empty" }, "No saved chats yet"));
    return;
  }
  for (const c of chats) {
    const li = h(
      "li",
      { dataset: { id: c.id } },
      h("a", { href: `#/chat/${c.id}`, title: c.title }, c.title),
      h(
        "span",
        { class: "chat-actions" },
        iconBtn("edit", "Rename chat", async () => {
          const t = await promptDialog("Rename chat", c.title);
          if (t) {
            await renameChat(c.id, t);
            if (app.chat && app.chat.id === c.id) app.chat.title = t;
            renderChatList();
          }
        }),
        iconBtn("trash", "Delete chat", async () => {
          if (!(await confirmDialog("Delete chat?", `“${c.title}” will be removed from this browser.`))) return;
          await deleteChat(c.id);
          if (app.chat && app.chat.id === c.id) {
            startNewChat();
            location.hash = "#/chat";
          }
          renderChatList();
        }),
      ),
    );
    els.chatList.append(li);
  }
  highlightChat();
}
app.renderChatList = renderChatList;

function highlightChat() {
  for (const li of els.chatList.querySelectorAll("li[data-id]")) {
    li.classList.toggle("active", app.view === "chat" && !!app.chat && li.dataset.id === app.chat.id);
  }
}

function startNewChat() {
  app.chat = newChat(llm.modelId || els.modelSelect.value);
  els.title.textContent = "Chat";
  renderMessages();
  highlightChat();
}

async function openChat(id) {
  const chat = await getChat(id);
  if (!chat) {
    toast("Chat not found");
    location.hash = "#/chat";
    startNewChat();
    return;
  }
  app.chat = chat;
  renderMessages();
  renderStats();
}

// ---------------- Messages ----------------
const SUGGESTIONS = [
  "Explain how a transformer language model works in three short paragraphs.",
  "Write a Python function that checks if a string is a palindrome, with tests.",
  "Give me five ideas for a weekend project using a Raspberry Pi.",
  "Summarize the pros and cons of running AI models on-device.",
];

function renderMessages() {
  const box = els.messages;
  box.innerHTML = "";
  const chat = app.chat;
  if (!chat || !chat.messages.length) {
    const ready = llm.modelId ? `${llm.model.label} is loaded.` : "Pick a model above. It downloads once, is saved in this browser, and then works offline.";
    box.append(
      h(
        "div",
        { class: "empty-state" },
        h("img", { src: "icons/icon.svg", width: 48, height: 48, alt: "" }),
        h("h2", null, "Chat with a model on this device"),
        h("p", null, ready),
        h(
          "div",
          { class: "suggestions" },
          SUGGESTIONS.map((t) =>
            h(
              "button",
              {
                type: "button",
                class: "suggestion",
                onclick: () => {
                  els.prompt.value = t;
                  autosize();
                  els.composer.requestSubmit();
                },
              },
              t,
            ),
          ),
        ),
      ),
    );
    return;
  }
  chat.messages.forEach((m, i) => box.append(messageEl(m, i)));
  box.scrollTop = box.scrollHeight;
}

function metaFor(m) {
  const st = m.stats;
  const parts = [];
  if (m.modelLabel) parts.push(m.modelLabel);
  if (st) {
    if (st.completionTokens != null) parts.push(`${st.completionTokens} tok`);
    if (st.decodeTps != null) parts.push(`${fmtNum(st.decodeTps)} tok/s`);
    if (st.prefillTps != null) parts.push(`prefill ${fmtNum(st.prefillTps, 0)} tok/s`);
    if (st.ttftMs != null) parts.push(`TTFT ${fmtMs(st.ttftMs)}`);
    if (st.contextTokens != null && st.contextWindow) parts.push(`ctx ${st.contextTokens}/${st.contextWindow}`);
    if (st.finishReason === "length") parts.push("hit length limit");
    if (st.finishReason === "interrupted") parts.push("stopped");
    if (st.droppedMessages) parts.push(`${st.droppedMessages} old msg dropped`);
  }
  return parts;
}

function messageEl(m, idx) {
  if (m.role === "user") {
    return h("div", { class: "msg msg-user" }, h("div", { class: "bubble" }, m.content));
  }
  const bubble = h("div", { class: "bubble", html: renderMarkdown(m.content) });
  const meta = h("div", { class: "msg-meta" });
  meta.append(
    iconBtn("copy", "Copy reply", async () => {
      try {
        await navigator.clipboard.writeText(m.content);
        toast("Copied");
      } catch {
        toast("Copy failed");
      }
    }),
  );
  const isLast = idx === app.chat.messages.length - 1;
  if (isLast) meta.append(iconBtn("redo", "Regenerate", () => regenerate()));
  for (const p of metaFor(m)) meta.append(h("span", null, p));
  const wrap = h("div", { class: "msg msg-assistant" }, bubble);
  if (m.error) wrap.append(h("div", { class: "msg-error" }, "Error: " + m.error));
  wrap.append(meta);
  return wrap;
}

function updateSendButton() {
  const gen = llm.state === "generating";
  els.sendBtn.classList.toggle("stop", gen);
  els.sendBtn.setAttribute("aria-label", gen ? "Stop" : "Send");
  els.sendBtn.disabled = llm.state === "loading";
}

function nearBottom() {
  const b = els.messages;
  return b.scrollHeight - b.scrollTop - b.clientHeight < 80;
}

async function send() {
  const text = els.prompt.value.trim();
  if (!text || llm.state === "loading" || llm.state === "generating") return;
  if (!app.gpu || !app.gpu.available) {
    toast("WebGPU is not available in this browser");
    return;
  }
  const selected = els.modelSelect.value;
  if (llm.modelId !== selected) {
    await loadModel(selected);
    if (llm.modelId !== selected) return;
  }
  els.prompt.value = "";
  autosize();
  const chat = app.chat || newChat(llm.modelId);
  app.chat = chat;
  if (!chat.messages.length) chat.title = titleFrom(text);
  chat.modelId = llm.modelId;
  chat.messages.push({ role: "user", content: text, at: Date.now() });
  if (els.messages.querySelector(".empty-state")) els.messages.innerHTML = "";
  els.messages.append(messageEl(chat.messages[chat.messages.length - 1], chat.messages.length - 1));
  els.messages.scrollTop = els.messages.scrollHeight;
  await saveChat(chat);
  if (location.hash !== `#/chat/${chat.id}`) history.replaceState(null, "", `#/chat/${chat.id}`);
  els.title.textContent = chat.title;
  renderChatList();
  await runAssistant();
}

async function regenerate() {
  const chat = app.chat;
  if (!chat || llm.state === "generating" || llm.state === "loading") return;
  const last = chat.messages[chat.messages.length - 1];
  if (last && last.role === "assistant") chat.messages.pop();
  const selected = els.modelSelect.value;
  if (llm.modelId !== selected) {
    await loadModel(selected);
    if (llm.modelId !== selected) return;
  }
  renderMessages();
  await runAssistant();
}

async function runAssistant() {
  const chat = app.chat;
  const history = chat.messages.filter((m) => !m.error || m.content).map((m) => ({ role: m.role, content: m.content }));
  if (els.messages.querySelector(".empty-state")) els.messages.innerHTML = "";
  const bubble = h("div", { class: "bubble cursor" });
  const meta = h("div", { class: "msg-meta" }, h("span", null, llm.model.label), h("span", null, "Prefilling…"));
  const wrap = h("div", { class: "msg msg-assistant" }, bubble, meta);
  els.messages.append(wrap);
  els.messages.scrollTop = els.messages.scrollHeight;

  const t0 = performance.now();
  app.live = { tokens: 0, tFirst: null, t0, tps: null };
  let pending = null;
  let latest = "";
  const paint = () => {
    pending = null;
    const stick = nearBottom();
    bubble.innerHTML = renderMarkdown(latest);
    const lv = app.live;
    meta.lastChild.textContent = lv.tps ? `${fmtNum(lv.tps)} tok/s · ${lv.tokens} tok` : "Prefilling…";
    renderStats();
    if (stick) els.messages.scrollTop = els.messages.scrollHeight;
  };
  const onToken = (text) => {
    latest = text;
    const now = performance.now();
    const lv = app.live;
    lv.tokens++;
    if (lv.tFirst === null) lv.tFirst = now;
    else lv.tps = (lv.tokens - 1) / ((now - lv.tFirst) / 1000);
    if (!pending) pending = requestAnimationFrame(paint);
  };

  const msg = { role: "assistant", content: "", at: Date.now(), model: llm.modelId, modelLabel: llm.model.label };
  try {
    const { text, gen } = await llm.generate(history, { onToken, conversationId: chat.id });
    msg.content = text;
    msg.stats = pickStats(gen);
    msg.stats.droppedMessages = gen.droppedMessages || 0;
  } catch (err) {
    msg.content = latest;
    msg.error = err && err.message ? err.message : String(err);
    if (llm.state === "error") showBanner("The GPU device was lost. Reload the model to continue.", true);
  }
  if (pending) cancelAnimationFrame(pending);
  app.live = null;
  chat.messages.push(msg);
  await saveChat(chat);
  wrap.replaceWith(messageEl(msg, chat.messages.length - 1));
  // Remove regenerate button from older assistant messages
  renderMessagesMetaOnly();
  renderStats();
  renderChatList();
  if (nearBottom()) els.messages.scrollTop = els.messages.scrollHeight;
}

function renderMessagesMetaOnly() {
  const nodes = els.messages.querySelectorAll(".msg-assistant");
  nodes.forEach((n, i) => {
    if (i < nodes.length - 1) {
      const redo = n.querySelector('.msg-meta [aria-label="Regenerate"]');
      if (redo) redo.remove();
    }
  });
}

function pickStats(g) {
  return {
    promptTokens: g.promptTokens,
    completionTokens: g.completionTokens,
    contextTokens: g.contextTokens,
    contextWindow: g.contextWindow,
    ttftMs: g.ttftMs,
    prefillTps: g.prefillTps,
    decodeTps: g.decodeTps,
    wallDecodeTps: g.wallDecodeTps,
    e2eMs: g.e2eMs,
    finishReason: g.finishReason,
    reusedKV: g.reusedKV,
  };
}

// ---------------- Live stats strip ----------------
function stat(label, value, sub, cls) {
  return h("div", { class: "stat" + (cls ? " " + cls : "") }, h("div", { class: "stat-label" }, label), h("div", { class: "stat-value", html: value }), sub != null ? h("div", { class: "stat-sub" }, sub) : null);
}

function renderStats() {
  const strip = els.statsStrip;
  strip.innerHTML = "";
  const s = llm.session;
  const sum = s ? s.summary() : null;
  const live = app.live;
  const g = app.lastGen && s && s.r.generations.includes(app.lastGen) ? app.lastGen : s && s.r.generations[s.r.generations.length - 1];
  const tps = live && live.tps ? live.tps : g ? g.decodeTps : null;
  strip.append(stat(live ? "Decode (live)" : "Decode", `${fmtNum(tps)} <small>tok/s</small>`, sum && sum.decodeTpsMedian ? `median ${fmtNum(sum.decodeTpsMedian)}` : "tokens per second"));
  strip.append(stat("Prefill", `${fmtNum(g ? g.prefillTps : null, 0)} <small>tok/s</small>`, g && g.promptTokens != null ? `${g.promptTokens} prompt tok` : "prompt processing"));
  strip.append(stat("First token", fmtMs(g ? g.ttftMs : null), g ? `total ${fmtMs(g.e2eMs)}` : "latency"));
  // Context
  const win = llm.model ? llm.model.contextWindow : null;
  const used = g ? g.contextTokens : 0;
  const pct = win ? Math.min(100, (used / win) * 100) : 0;
  const ctx = stat("Context", `${used || 0}<small> / ${win || "–"}</small>`, null);
  ctx.append(h("div", { class: "ctx-bar" + (pct > 80 ? " warn" : "") }, h("div", { style: `width:${pct}%` })));
  strip.append(ctx);
  strip.append(stat("Session", `${sum ? sum.generations : 0} <small>replies</small>`, sum ? `${sum.completionTokens} tokens out` : "no model loaded", "wide-only"));
  const load = s && s.r.load.totalMs != null ? s.r.load : null;
  strip.append(
    stat(
      "Load",
      fmtMs(load ? load.totalMs : null),
      load ? (load.cachedBefore > 0.97 ? "from OPFS cache" : `downloaded ${fmtBytes(load.downloadBytes)}`) : llm.state === "loading" ? "loading…" : "–",
      "wide-only",
    ),
  );
  strip.append(stat("GPU", app.gpu && app.gpu.available ? (app.gpu.shaderF16 ? "f16 ✓" : "f32 only") : "none", gpuLabel(app.gpu), "wide-only"));
}
app.renderStats = renderStats;

window.__app = app; // handy for debugging from the console
init();

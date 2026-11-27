// Entry point of the default UI. Loaded by index.html.
// Order matters: build the layout, tell the watchdog we're alive (app.ready),
// then initialise the core (model list, GPU, storage) and fill in the views.
import { app } from "../core/api.js";
import { state, $, lsGet, lsSet } from "./state.js";
import { buildLayout, setSidebar } from "./layout.js";
import { toast, h, modal } from "./dom.js";
import { installCopyHandler } from "./markdown.js";
import { initSidebar, renderSidebar } from "./sidebar.js";
import { initChatView, showChat, showBanner } from "./chat/chat-view.js";
import { initModelPicker } from "./chat/model-picker.js";
import { renderStats } from "./chat/stats-strip.js";

const VIEWS = {
  models: () => import("./views/models.js"),
  dashboard: () => import("./views/dashboard.js"),
  benchmark: () => import("./views/benchmark.js"),
  studio: () => import("./views/studio.js"),
  settings: () => import("./views/settings.js"),
  run: () => import("./views/run.js"),
  storage: () => import("./views/storage.js"),
};
const TITLES = { chat: "Chat", models: "Models", dashboard: "Stats dashboard", benchmark: "Benchmark", studio: "Studio", settings: "Settings", run: "App", storage: "Storage" };

async function route() {
  const [, view = "chat", id, ...rest] = (location.hash || "#/chat").split("/");
  const v = TITLES[view] ? view : "chat";
  state.view = v;
  for (const [name, el] of Object.entries($("views"))) el.hidden = name !== v;
  for (const a of document.querySelectorAll(".nav a")) a.classList.toggle("active", a.dataset.nav === v);
  $("modelBar").hidden = v !== "chat";
  $("statsToggle").hidden = v !== "chat";
  $("title").textContent = TITLES[v];
  // Studio workspaces and running apps use the full width on desktop.
  const focus = (v === "studio" && !!id) || v === "run";
  $("app").classList.toggle("focus-mode", focus);
  // Phones: normal pages scroll the whole document; Studio workspaces and apps stay full screen.
  document.documentElement.classList.toggle("doc-scroll", !focus);
  if (v !== "chat") window.scrollTo(0, 0);
  setSidebar(false);
  app.emit("usage", { event: "page", page: v, mobile: matchMedia("(max-width: 820px)").matches, wide: innerWidth >= 1800 });
  if (v === "chat") {
    await showChat(id ? decodeURIComponent(id) : null);
  } else {
    const mod = await VIEWS[v]();
    await mod.render($("views")[v], [id, ...rest].filter(Boolean).map(decodeURIComponent));
  }
  renderSidebar();
}
app.route = route;

function bindChrome() {
  $("openSidebar").onclick = () => setSidebar(true);
  $("closeSidebar").onclick = () => setSidebar(false);
  $("scrim").onclick = () => setSidebar(false);
  const strip = $("statsStrip");
  const toggle = $("statsToggle");
  document.body.classList.toggle("hide-msg-stats", lsGet("showMsgStats", "1") === "0");
  if (lsGet("showStats", "1") === "0") {
    toggle.setAttribute("aria-pressed", "false");
    strip.classList.add("collapsed");
  }
  toggle.onclick = () => {
    const on = toggle.getAttribute("aria-pressed") !== "true";
    toggle.setAttribute("aria-pressed", String(on));
    strip.classList.toggle("collapsed", !on);
    lsSet("showStats", on ? "1" : "0");
  };
  window.addEventListener("pagehide", () => app.llm.session && app.llm.session.endSoon());
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) return;
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker registration failed", e));
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) toast("App updated. Reload to use the new version.", 5000);
  });
}

async function updateFoot() {
  try {
    const e = await navigator.storage.estimate();
    const fmt = app.models.fmtBytes;
    $("sidebarFoot").textContent = `Storage used: ${fmt(e.usage)} of ${fmt(e.quota)}`;
  } catch {
    $("sidebarFoot").textContent = "";
  }
}
app.on("models-changed", updateFoot);

// The GPU ran out of memory: everything was unloaded (see app.handleOutOfMemory).
// Explain it, and offer the stats page centered on the moment it happened.
let oomDialog = null;
function showOutOfMemory({ at, model, message, during }) {
  if (oomDialog && oomDialog.open) return;
  const where = during === "load" ? "while loading it" : during && during.startsWith("builder") ? "while Studio was building" : "while it was replying";
  oomDialog = modal(
    "Ran out of GPU memory",
    h(
      "div",
      { class: "oom-dialog" },
      h("p", { style: "margin-top:0" }, `${model ? model.label : "A model"} used more GPU memory than this device allows ${where}. To get performance back, every model in every window was unloaded.`),
      h(
        "dl",
        { class: "kv" },
        h("dt", null, "When"),
        h("dd", null, new Date(at).toLocaleTimeString()),
        h("dt", null, "Error"),
        h("dd", { class: "mono" }, String(message || "").slice(0, 200)),
      ),
      h("p", { class: "note" }, "Try a smaller model, a shorter conversation, or closing other tabs and apps. In Studio, this model now gets a smaller context next time (down to 4k); if it crashes even then, it's marked ⚠ and Auto skips it."),
      h(
        "div",
        { class: "row", style: "justify-content:flex-end;margin-top:14px" },
        h("button", { class: "btn", type: "button", onclick: () => oomDialog.close() }, "Dismiss"),
        h(
          "button",
          {
            class: "btn btn-primary",
            type: "button",
            onclick: () => {
              oomDialog.close();
              location.hash = `#/dashboard/timeline/${at}`;
            },
          },
          "See what happened",
        ),
      ),
    ),
  );
}

async function start() {
  buildLayout(document.getElementById("root"));
  bindChrome();
  installCopyHandler($("messages"));
  app.ready(); // the UI code loaded and rendered: stop the startup watchdog
  registerSW();

  await app.init();
  if (!app.opfsAvailable()) showBanner("This browser can't save files (no Origin Private File System), so chats, stats and model downloads won't be kept.", true);
  if (app.catalogError) showBanner("Could not load the model list: " + app.catalogError.message, true);
  if (!app.gpu || !app.gpu.available) {
    showBanner(`WebGPU isn't available in this browser (${(app.gpu && app.gpu.reason) || "unsupported"}). Use a recent Chrome or Edge, or Safari 26+ on iPhone, iPad or Mac.`, true);
    app.recordUnsupportedOnce();
  }
  if (window.__safe) toast("Safe mode: showing the default UI.", 5000);
  if (lsGet("uiRolledBack") === "1") {
    lsSet("uiRolledBack", "0");
    showBanner("Your custom UI didn't start last time, so the default UI is back. Fix or switch UIs in Studio.", true);
  }
  app.on("out-of-memory", showOutOfMemory);
  app.on("auto-deleted", ({ models, chats }) => {
    const parts = [];
    if (models.length) parts.push(`${models.length} model(s)`);
    if (chats.length) parts.push(`${chats.length} chat(s)`);
    toast(`Auto-deleted ${parts.join(" and ")} not used recently`, 5000);
  });
  initSidebar();
  initModelPicker();
  initChatView();
  renderStats();
  window.addEventListener("hashchange", route);
  await route();
  updateFoot();
}

start();

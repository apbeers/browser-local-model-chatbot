// Runs a pinned Studio app full screen (loaded by pin.html at pins/<id>/).
// Works offline once the service worker is installed. If this storage has no
// copy of the app (a fresh iPhone/iPad Home Screen app), it installs the copy
// packed into the address when the app was pinned.
import { app } from "./api.js";
import { unpack } from "./pins.js";

const id = window.__PIN_ID;
const frame = document.getElementById("frame");
const ui = document.getElementById("pin-ui");

function card(...children) {
  const el = document.createElement("div");
  el.className = "pin-card";
  el.append(...children);
  ui.append(el);
  return el;
}
function text(t, tag = "div") {
  const el = document.createElement(tag);
  el.textContent = t;
  return el;
}
function button(label, onclick, primary) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (primary) b.className = "primary";
  b.onclick = onclick;
  return b;
}
function toast(t) {
  const el = card(text(t));
  setTimeout(() => el.remove(), 3000);
}
const isIOS = () => ["iphone", "ipad"].includes(app.install.platform());

// Loading a model inside a pinned app: ask first if it needs downloading.
app.loadModel = async (modelId) => {
  const m = app.models.findModel(app.catalog, modelId);
  if (!m) return false;
  if (!app.isSaved(m)) {
    const why = isIOS() && app.install.isStandalone() ? " On iPhone and iPad, Home Screen apps keep their own storage, so the model downloads once more for this app." : "";
    const ok = await new Promise((resolve) => {
      const c = card(
        text(`This app uses the on-device AI. Download ${m.label} (${m.bytes ? app.models.fmtBytes(m.bytes) : "large"})?${why}`),
        button("Download", () => (c.remove(), resolve(true)), true),
        button("Not now", () => (c.remove(), resolve(false))),
      );
    });
    if (!ok) return false;
  }
  const bar = document.createElement("progress");
  const label = text("Loading the model…");
  const c = card(label, bar);
  const onProgress = (e) => {
    bar.value = e.detail.progress || 0;
    label.textContent = e.detail.text || "Loading…";
  };
  app.llm.addEventListener("progress", onProgress);
  try {
    await app.llm.load(modelId);
    return true;
  } catch (err) {
    toast("The model didn't load: " + (err.message || err));
    return false;
  } finally {
    app.llm.removeEventListener("progress", onProgress);
    c.remove();
  }
};

function installHint() {
  if (app.install.isStandalone()) return;
  try {
    if (localStorage.getItem("pinHint-" + id) === "0") return;
  } catch {
    /* ignore */
  }
  const dismiss = (c) => {
    c.remove();
    try {
      localStorage.setItem("pinHint-" + id, "0");
    } catch {
      /* ignore */
    }
  };
  const p = app.install.platform();
  if (app.install.canPrompt()) {
    const c = card(text("Install this app so it opens from your Home Screen or desktop and works offline."), button("Install", () => app.install.promptInstall().then(() => c.remove()), true), button("Not now", () => dismiss(c)));
  } else if (p === "iphone" || p === "ipad") {
    const c = card(text("To add it to your Home Screen: tap Share, then Add to Home Screen. Open it once while online to finish setting it up."), button("OK", () => dismiss(c)));
  } else if (p === "mac-safari") {
    const c = card(text("To install: File → Add to Dock."), button("OK", () => dismiss(c)));
  }
}

async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  await app.init();
  let info = await app.apps.getApp(id);
  let html = info ? await app.apps.readApp(id) : "";
  if (!html) {
    const packed = (location.hash.match(/app=([^&]+)/) || [])[1];
    if (packed) {
      try {
        html = await unpack(packed);
        const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "App";
        info = await app.apps.createApp({ id, name: title, html, template: "pinned" });
      } catch (err) {
        console.warn("could not unpack the pinned app", err);
      }
    }
  }
  if (!html) {
    card(text("This app isn't on this device anymore. It may have been deleted in Studio."));
    return;
  }
  document.title = info.name;
  app.apps.mount(frame, { appId: id, html, onNotify: toast });
  app.install.onInstallChange(() => {
    ui.querySelectorAll(".pin-card").forEach((c) => c.remove());
    installHint();
  });
  installHint();
}

start();

// The model dropdown and Load button in the top bar, plus loadModel(), which
// every view uses to download/load a model with a confirmation for big downloads.
import { app } from "../../core/api.js";
import { state, $, lsGet, lsSet } from "../state.js";
import { h, toast, confirmDialog } from "../dom.js";
import { showBanner, hideBanner } from "./chat-view.js";

const PREFERRED = ["Qwen2.5-0.5B-Instruct-q4f16_1-MLC", "SmolLM2-360M-Instruct-q4f32_1-MLC"];

export function initModelPicker() {
  $("modelSelect").onchange = () => {
    lsSet("model", $("modelSelect").value);
    updateLoadButton();
  };
  $("loadBtn").onclick = () => loadModel($("modelSelect").value);
  app.on("models-changed", () => populateModelSelect());
  app.llm.addEventListener("state", () => updateLoadButton());
  app.llm.addEventListener("progress", (e) => {
    const r = e.detail;
    const pct = Math.round((r.progress || 0) * 100);
    $("loadbar").hidden = false;
    $("loadText").textContent = r.text || "Loading…";
    $("loadPct").textContent = pct + "%";
    $("loadFill").style.width = pct + "%";
    app.emit("load-progress", r);
  });
  app.llm.addEventListener("state", () => {
    $("loadbar").hidden = app.llm.state !== "loading";
  });
  populateModelSelect();
}

// Fill the dropdown, grouped by size. "More" models only appear when enabled
// in settings, or when already saved / selected.
export async function populateModelSelect() {
  const sel = $("modelSelect");
  if (!app.catalog) return;
  const settings = await app.settings.get();
  const current = app.llm.modelId || sel.value || lsGet("model");
  const groups = {};
  for (const m of app.catalog.all) {
    if (!m.quick && !settings.showAllModels && !app.isSaved(m) && m.id !== current) continue;
    (groups[m.group] ||= []).push(m);
  }
  const gpuKnown = app.gpu && app.gpu.available;
  sel.innerHTML = "";
  for (const g of ["small", "medium", "large", "more"]) {
    if (!groups[g]) continue;
    const og = h("optgroup", { label: app.models.GROUP_LABELS[g] });
    for (const m of groups[g]) {
      const usable = app.modelUsable(m);
      const size = m.bytes != null ? app.models.fmtBytes(m.bytes) : `~${app.models.fmtBytes(m.vramMB * 1048576)} GPU`;
      const label = `${app.isSaved(m) ? "✓ " : ""}${m.label} · ${size}${usable || !gpuKnown ? "" : " · needs f16"}`;
      og.append(h("option", { value: m.id, disabled: !usable && gpuKnown ? true : null }, label));
    }
    sel.append(og);
  }
  const ok = (id) => id && [...sel.options].some((o) => o.value === id && !o.disabled);
  sel.value = ok(current) ? current : PREFERRED.find(ok) || ([...sel.options].find((o) => !o.disabled) || {}).value || "";
  updateLoadButton();
}

export function selectModel(id) {
  const sel = $("modelSelect");
  if ([...sel.options].some((o) => o.value === id && !o.disabled)) {
    sel.value = id;
    updateLoadButton();
  }
}

export function updateLoadButton() {
  const b = $("loadBtn");
  const id = $("modelSelect").value;
  const st = app.llm.state;
  if (st === "loading") {
    b.textContent = "Loading…";
    b.disabled = true;
  } else if (app.llm.modelId === id && (st === "ready" || st === "generating")) {
    b.textContent = "Loaded";
    b.disabled = true;
  } else {
    const m = app.catalog && app.models.findModel(app.catalog, id);
    b.textContent = m && app.isSaved(m) ? "Load" : "Download";
    b.disabled = !m || !app.modelUsable(m) || st === "generating";
  }
  $("modelSelect").disabled = st === "loading" || st === "generating";
}

// Asks before downloads of 1 GB or more. Returns false if the user cancels.
async function confirmDownload(m) {
  if (app.isSaved(m) || navigator.onLine === false) return true;
  const mobile = /Android|iPhone|iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  const big = m.bytes == null ? m.vramMB > 1500 : m.bytes >= 1e9;
  if (!big) return true;
  const size = m.bytes != null ? app.models.fmtBytes(m.bytes) : "a large amount of data";
  const warn = mobile && (m.bytes || m.vramMB * 1048576) > 2.5e9 ? " Models this large often run out of memory on phones." : "";
  return confirmDialog(`Download ${m.label}?`, `This downloads ${size} from Hugging Face and saves it on this device.${warn}`, "Download", false);
}

// Download (if needed) and load a model. opts are passed to app.llm.load.
export async function loadModel(id, opts) {
  const m = app.catalog && app.models.findModel(app.catalog, id);
  if (!m || !(await confirmDownload(m))) return false;
  if ($("modelSelect").querySelector(`option[value="${CSS.escape(id)}"]`)) $("modelSelect").value = id;
  lsSet("model", id);
  hideBanner();
  const wasSaved = app.isSaved(m);
  let ok = false;
  try {
    await app.llm.load(id, opts);
    toast(`${m.label} is ready`);
    if (!wasSaved && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    ok = true;
  } catch (err) {
    showBanner("Model failed to load: " + (err && err.message ? err.message : err), true);
    app.emit("load-failed", err);
  }
  await app.refreshModels();
  return ok;
}
app.loadModel = loadModel; // shared with views (models page, benchmark, studio)

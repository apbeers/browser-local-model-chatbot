// Stats dashboard, "Memory and storage" section:
//   - live GPU memory per window and model (measured by counting every GPU
//     buffer the engine allocates; estimated when no measurement exists yet)
//   - live JavaScript memory of this page (Chrome/Edge only)
//   - storage used by each part of the app (each model, chats, apps, offline copies…)
//   - measured GPU memory per model from past sessions
import { app } from "../../core/api.js";
import { h, fmtNum } from "../dom.js";
import { hBarChart, colorVar, tipContent } from "../charts.js";

let timer = null;
const MB = 1048576;
const fmt = (mb) => app.models.fmtBytes(mb * MB);

function stopLive() {
  clearInterval(timer);
  timer = null;
}

function liveGpu(box) {
  const rows = [];
  if (app.llm.modelId) {
    const measured = app.llm.gpu && app.llm.gpu.bytes;
    rows.push({ label: `${app.llm.model.label} · this window`, mb: measured ? app.llm.gpu.bytes / MB : app.memory.estimateMB(app.llm.model, app.llm.contextWindow), measured: !!measured, busy: app.llm.state === "generating", peak: app.llm.gpu ? app.llm.gpu.peak / MB : 0 });
  }
  for (const p of app.memory.loadedElsewhere()) rows.push({ label: `${p.label} · ${p.title || "another window"}`, mb: p.mb, measured: !!p.measured, busy: p.busy });
  const total = rows.reduce((s, r) => s + r.mb, 0);
  const budget = app.memory.budgetMB();
  const pct = Math.min(100, (total / budget) * 100);
  box.replaceChildren(
    h(
      "div",
      { class: "row" },
      h("div", { class: "spacer" }, h("div", { class: "stat-label" }, "GPU memory used by models"), h("div", { class: "stat-value", html: `${fmt(total)} <small>of ≈${fmt(budget)} budget</small>` })),
    ),
    h("div", { class: "ctx-bar" + (pct > 85 ? " warn" : ""), style: "height:8px;margin:8px 0 12px" }, h("div", { style: `width:${pct}%` })),
    rows.length
      ? h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "table" },
            h("thead", null, h("tr", null, h("th", null, "Model · window"), h("th", { class: "num" }, "GPU memory"), h("th", null, "How"), h("th", null, "Status"))),
            h(
              "tbody",
              null,
              rows.map((r) =>
                h(
                  "tr",
                  null,
                  h("td", null, r.label),
                  h("td", { class: "num" }, fmt(r.mb) + (r.peak && r.peak > r.mb * 1.02 ? ` (peak ${fmt(r.peak)})` : "")),
                  h("td", null, r.measured ? "measured" : "estimated"),
                  h("td", null, r.busy ? "generating" : "idle"),
                ),
              ),
            ),
          ),
        )
      : h("p", { class: "note" }, "No model is loaded in any window."),
  );
}

function liveJs(box) {
  const m = performance.memory;
  const d = navigator.deviceMemory;
  box.replaceChildren(
    h("div", { class: "stat-label" }, "Page memory (JavaScript)"),
    m ? h("div", { class: "stat-value", html: `${fmt(m.usedJSHeapSize / MB)} <small>of ${fmt(m.jsHeapSizeLimit / MB)} limit</small>` }) : h("div", { class: "stat-value" }, "–"),
    h("div", { class: "stat-sub" }, m ? "This window's chats, UI and data in memory" : "This browser doesn't report it (Chrome and Edge do)"),
    h("div", { class: "stat-sub" }, d ? `Device memory: ≥ ${d} GB (rounded by the browser)` : "Device memory: not shared by the browser"),
  );
}

async function storageChart(box) {
  box.replaceChildren(h("p", { class: "note" }, "Measuring…"));
  const b = await app.storage.breakdown(app.catalog, app.models.scanModelCache);
  const groups = { Models: 0, "Your data": 1, "Offline copies": 2 };
  const rows = b.parts.map((p) => ({
    label: `${p.group === "Models" ? "Model: " : ""}${p.label}`,
    value: p.bytes / MB,
    valueLabel: app.models.fmtBytes(p.bytes),
    color: colorVar(groups[p.group] ?? 3),
    tip: tipContent(p.label, [
      ["Size", app.models.fmtBytes(p.bytes)],
      ["Kind", p.group],
      ["What it is", p.source || ""],
    ]),
  }));
  const sum = b.parts.reduce((s, p) => s + p.bytes, 0);
  const chart = h("div");
  box.replaceChildren(
    h("p", { class: "note" }, `${app.models.fmtBytes(sum)} across ${b.parts.length} parts${b.usage != null ? ` · the browser reports ${app.models.fmtBytes(b.usage)} used of ${app.models.fmtBytes(b.quota)}` : ""}. Bar color: blue = models, orange = your data, green = offline copies.`),
    chart,
    h("p", { class: "note" }, h("a", { href: "#/storage" }, "Open the storage manager"), " to see or delete individual files."),
  );
  hBarChart(chart, rows, { unit: " MB" });
}

function history(box, filtered) {
  const byModel = {};
  for (const s of filtered) {
    const label = s.model.label || s.model.id;
    const e = (byModel[label] ||= { load: [], peak: [] });
    if (s.load && s.load.gpuMB) e.load.push(s.load.gpuMB);
    for (const g of s.generations || []) if (g.gpuPeakMB) e.peak.push(g.gpuPeakMB);
  }
  const { median } = app.stats;
  const rows = Object.entries(byModel)
    .filter(([, v]) => v.load.length || v.peak.length)
    .map(([label, v]) => {
      const load = median(v.load);
      const peak = median(v.peak);
      return {
        label,
        value: peak || load || 0,
        valueLabel: fmt(peak || load || 0),
        tip: tipContent(label, [
          ["After loading (median)", load ? fmt(load) : "–"],
          ["Peak while replying (median)", peak ? fmt(peak) : "–"],
          ["Sessions measured", String(v.load.length)],
        ]),
      };
    })
    .sort((a, b) => b.value - a.value);
  if (!rows.length) {
    box.replaceChildren(h("p", { class: "note" }, "No measurements yet. GPU memory is recorded for every model load and reply from now on."));
    return;
  }
  box.replaceChildren();
  hBarChart(box, rows, { unit: " MB" });
}

export function renderMemory(page, { filtered }) {
  stopLive();
  const gpu = h("div", { class: "chart-card" });
  const js = h("div", { class: "kpi" });
  const storage = h("div");
  const hist = h("div");
  page.append(
    h("h2", null, "Memory and storage"),
    h("div", { class: "mem-grid" }, gpu, js),
    h(
      "div",
      { class: "charts" },
      h("div", { class: "chart-card" }, h("h3", null, "Measured GPU memory by model"), h("p", { class: "sub" }, "Median peak while replying (from past sessions on the filters above). Hover for after-load numbers."), hist),
      h(
        "div",
        { class: "chart-card" },
        h("div", { class: "row" }, h("h3", { class: "spacer" }, "Storage by part"), h("button", { class: "btn btn-sm", type: "button", onclick: () => storageChart(storage) }, "Refresh")),
        h("p", { class: "sub" }, "What each part of the app keeps on this device."),
        storage,
      ),
    ),
  );
  const tick = () => {
    if (!document.body.contains(gpu)) return stopLive();
    liveGpu(gpu);
    liveJs(js);
  };
  tick();
  timer = setInterval(tick, 1000);
  storageChart(storage);
  history(hist, filtered);
}

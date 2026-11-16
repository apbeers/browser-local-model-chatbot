// Stats dashboard: reads every session record from OPFS (own + imported),
// filters, aggregates and charts them. Export/import JSON to compare devices.
import { h, toast, confirmDialog, modal, fmtNum, fmtMs, fmtDate, downloadFile, pickFile } from "../ui.js";
import { loadAllSessions, deleteSession, exportSessions, importBundle, median, percentile } from "../stats.js";
import { hBarChart, groupedHBarChart, xyChart, colorVar, tipContent, disposeCharts } from "../charts.js";
import { gpuLabel } from "../device.js";
import { fmtBytes } from "../models.js";

const RANGES = [
  ["all", "All time", Infinity],
  ["1d", "24 hours", 86400000],
  ["7d", "7 days", 7 * 86400000],
  ["30d", "30 days", 30 * 86400000],
];
const GROUPS = {
  model: { label: "Model", key: (s) => s.model.label || s.model.id },
  device: { label: "Device", key: (s) => s.deviceLabel || "unknown" },
  modelDevice: { label: "Model × device", key: (s) => `${s.model.label || s.model.id} · ${s.deviceLabel || "?"}` },
  browser: { label: "Browser", key: (s) => `${s.device.browser} ${s.device.browserVersion}` },
  os: { label: "OS", key: (s) => s.device.os || "?" },
  gpu: { label: "GPU", key: (s) => gpuLabel(s.device.gpu) },
  day: { label: "Day", key: (s) => new Date(s.startedAt).toISOString().slice(0, 10) },
};

const state = {
  model: "all",
  device: "all",
  range: "all",
  groupBy: "modelDevice",
  sort: { key: "decodeMedian", dir: -1 },
};

export async function renderDashboard(root, app) {
  disposeCharts();
  root.innerHTML = "";
  const page = h("div", { class: "page" });
  root.append(page);
  const all = await loadAllSessions();
  let filtered = [];

  // Stable color per model: catalog order, then first-seen order for unknown/imported ones.
  // Only models that have data get a slot, so the first (most distinct) colors are used.
  const catalogOrder = app.catalog ? app.catalog.models.map((m) => m.label) : [];
  const present = [...new Set(all.filter((s) => s.generations.length || s.status !== "load-failed").map((s) => s.model.label || s.model.id))];
  const modelOrder = [...catalogOrder.filter((l) => present.includes(l)), ...present.filter((l) => !catalogOrder.includes(l))];
  const modelColor = (label) => colorVar(Math.max(0, modelOrder.indexOf(label)));

  const head = h(
    "div",
    { class: "row", style: "align-items:flex-start" },
    h(
      "div",
      { style: "flex:1;min-width:220px" },
      h("h1", null, "Stats dashboard"),
      h("p", { class: "lede" }, "Every model session on this device is logged to browser storage as it runs. Import exports from other devices to compare them here."),
    ),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: async () => {
            const files = await pickFile();
            if (!files.length) return;
            let added = 0;
            let skipped = 0;
            for (const f of files) {
              try {
                const r = await importBundle(JSON.parse(await f.text()));
                added += r.added;
                skipped += r.skipped;
              } catch (e) {
                toast(`${f.name}: ${e.message}`, 4000);
              }
            }
            toast(`Imported ${added} sessions${skipped ? `, skipped ${skipped} duplicates` : ""}`);
            renderDashboard(root, app);
          },
        },
        "Import JSON",
      ),
      h(
        "button",
        {
          class: "btn btn-primary",
          type: "button",
          onclick: async () => {
            const bundle = await exportSessions(filtered);
            const name = `llm-stats-${(bundle.exportedBy.label || "device").replace(/[^\w-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.json`;
            downloadFile(name, JSON.stringify(bundle, null, 1));
          },
        },
        "Export JSON",
      ),
    ),
  );
  page.append(head);

  if (!all.length) {
    page.append(h("div", { class: "card" }, "No sessions recorded yet. Load a model and chat. Every reply is logged here."));
    return;
  }

  // ---------- Filters ----------
  const models = [...new Set(all.map((s) => s.model.label || s.model.id))];
  const devices = [...new Set(all.map((s) => s.deviceLabel || "unknown"))];
  const sel = (id, label, options, value, on) => {
    const el = h("select", { class: "select", id }, options.map(([v, l]) => h("option", { value: v, selected: v === value ? true : null }, l)));
    el.onchange = () => on(el.value);
    return h("span", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, h("label", { for: id }, label), el);
  };
  const rerender = () => renderDashboard(root, app);
  page.append(
    h(
      "div",
      { class: "filters" },
      sel("f-model", "Model", [["all", "All models"], ...models.map((m) => [m, m])], state.model, (v) => ((state.model = v), rerender())),
      sel("f-device", "Device", [["all", "All devices"], ...devices.map((d) => [d, d])], state.device, (v) => ((state.device = v), rerender())),
      sel("f-range", "Time", RANGES.map(([v, l]) => [v, l]), state.range, (v) => ((state.range = v), rerender())),
    ),
  );

  const span = RANGES.find((r) => r[0] === state.range)[2];
  const now = Date.now();
  filtered = all.filter(
    (s) =>
      (state.model === "all" || (s.model.label || s.model.id) === state.model) &&
      (state.device === "all" || (s.deviceLabel || "unknown") === state.device) &&
      now - s.startedAt <= span,
  );
  const gens = filtered.flatMap((s) => s.generations.filter((g) => !g.error).map((g) => ({ ...g, s })));
  const loaded = filtered.filter((s) => s.load && s.load.totalMs != null && s.status !== "load-failed");
  const cachedLoads = loaded.filter((s) => s.load.cachedBefore > 0.97).map((s) => s.load.totalMs);
  const dlLoads = loaded.filter((s) => !(s.load.cachedBefore > 0.97)).map((s) => s.load.totalMs);
  const failures = filtered.filter((s) => s.status === "load-failed").length + filtered.reduce((a, s) => a + (s.errors ? s.errors.length : 0), 0);
  const decode = gens.map((g) => g.decodeTps);

  // ---------- KPIs ----------
  const kpi = (label, value, sub) => h("div", { class: "kpi" }, h("div", { class: "stat-label" }, label), h("div", { class: "stat-value", html: value }), sub ? h("div", { class: "stat-sub" }, sub) : null);
  page.append(
    h(
      "div",
      { class: "kpis" },
      kpi("Sessions", fmtNum(filtered.length, 0), `${new Set(filtered.map((s) => s.deviceId)).size} device(s)`),
      kpi("Replies", fmtNum(gens.length, 0), `${fmtNum(gens.reduce((a, g) => a + (g.completionTokens || 0), 0), 0)} tokens generated`),
      kpi("Decode", `${fmtNum(median(decode))} <small>tok/s</small>`, gens.length ? `p10 ${fmtNum(percentile(decode, 10))} · p90 ${fmtNum(percentile(decode, 90))}` : "median"),
      kpi("Prefill", `${fmtNum(median(gens.map((g) => g.prefillTps)), 0)} <small>tok/s</small>`, "median"),
      kpi("First token", fmtMs(median(gens.map((g) => g.ttftMs))), "median latency"),
      kpi("Load from cache", fmtMs(median(cachedLoads)), `${cachedLoads.length} loads`),
      kpi("Load + download", fmtMs(median(dlLoads)), `${dlLoads.length} loads`),
      kpi("Failures", fmtNum(failures, 0), "failed loads + errors"),
    ),
  );

  const charts = h("div", { class: "charts" });
  page.append(charts);
  const card = (title, sub, wide) => {
    const body = h("div");
    const c = h("div", { class: "chart-card", style: wide ? "grid-column:1/-1" : null }, h("h3", null, title), h("p", { class: "sub" }, sub), body);
    charts.append(c);
    return body;
  };

  // 1. Decode speed by model × device
  const byMD = groupBy(gens, (g) => `${g.s.model.label || g.s.model.id} · ${g.s.deviceLabel || "?"}`);
  const mdRows = Object.entries(byMD)
    .map(([label, gs]) => {
      const v = gs.map((g) => g.decodeTps);
      const med = median(v);
      return {
        label,
        value: med || 0,
        lo: percentile(v, 10),
        hi: percentile(v, 90),
        color: modelColor(gs[0].s.model.label || gs[0].s.model.id),
        tip: tipContent(label, [
          ["Replies", String(gs.length)],
          ["Median decode", fmtNum(med) + " tok/s"],
          ["p10 – p90", `${fmtNum(percentile(v, 10))} – ${fmtNum(percentile(v, 90))}`],
          ["Median prefill", fmtNum(median(gs.map((g) => g.prefillTps)), 0) + " tok/s"],
          ["Median TTFT", fmtMs(median(gs.map((g) => g.ttftMs)))],
        ]),
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 16);
  hBarChart(card("Decode speed by model and device", "Median tokens/second per reply; whiskers span p10–p90. Bar color = model."), mdRows, { unit: "" });

  // 2. Decode speed over time
  const modelsInView = [...new Set(gens.map((g) => g.s.model.label || g.s.model.id))].sort((a, b) => modelOrder.indexOf(a) - modelOrder.indexOf(b));
  xyChart(
    card("Decode speed over time", "Each mark is one reply. Shape and color = model."),
    modelsInView.map((ml, i) => ({
      name: ml,
      color: modelColor(ml),
      shape: ["circle", "square", "triangle", "diamond"][modelOrder.indexOf(ml) % 4],
      points: gens
        .filter((g) => (g.s.model.label || g.s.model.id) === ml && g.decodeTps)
        .map((g) => ({
          x: g.at,
          y: g.decodeTps,
          tip: tipContent(ml, [
            ["When", fmtDate(g.at)],
            ["Device", g.s.deviceLabel],
            ["Decode", fmtNum(g.decodeTps) + " tok/s"],
            ["Tokens", String(g.completionTokens)],
          ]),
        })),
    })),
    { kind: "scatter", time: true, xFormat: timeFormatter(gens.map((g) => g.at)), yFormat: (v) => fmtNum(v, 0) },
  );

  // 3. Throttling: throughput across a long reply
  const throttleSeries = modelsInView
    .map((ml) => {
      const ws = gens.filter((g) => (g.s.model.label || g.s.model.id) === ml && g.windowTps && g.windowTps.length >= 2).map((g) => g.windowTps);
      const maxLen = Math.max(0, ...ws.map((w) => w.length));
      const points = [];
      for (let i = 0; i < maxLen; i++) {
        const vals = ws.map((w) => w[i]).filter((v) => v != null);
        if (vals.length) points.push({ x: (i + 1) * 16, y: median(vals) });
      }
      return { name: ml, color: modelColor(ml), points };
    })
    .filter((se) => se.points.length > 1);
  xyChart(card("Speed through a long reply", "Median tok/s in 16-token windows by position in the reply. A falling line suggests thermal throttling or growing context cost."), throttleSeries, {
    kind: "line",
    xFormat: (v) => fmtNum(v, 0),
    xTitle: (v) => `Tokens ${v - 15}–${v}`,
    xLabel: "token position",
    yFormat: (v) => fmtNum(v, 1),
  });

  // 4. Decode vs context used
  xyChart(
    card("Decode speed vs context used", "Tokens already in the context (KV cache) at the end of each reply."),
    modelsInView.map((ml) => ({
      name: ml,
      color: modelColor(ml),
      shape: ["circle", "square", "triangle", "diamond"][modelOrder.indexOf(ml) % 4],
      points: gens
        .filter((g) => (g.s.model.label || g.s.model.id) === ml && g.decodeTps && g.contextTokens)
        .map((g) => ({ x: g.contextTokens, y: g.decodeTps, tip: tipContent(ml, [["Context", `${g.contextTokens} / ${g.contextWindow}`], ["Decode", fmtNum(g.decodeTps) + " tok/s"], ["Device", g.s.deviceLabel]]) })),
    })),
    { kind: "scatter", xFormat: (v) => fmtNum(v, 0), xLabel: "context tokens", yFormat: (v) => fmtNum(v, 0) },
  );

  // 5. TTFT vs prompt tokens
  xyChart(
    card("Time to first token vs prompt size", "New prompt tokens processed for each reply (reused context is not re-processed)."),
    modelsInView.map((ml) => ({
      name: ml,
      color: modelColor(ml),
      shape: ["circle", "square", "triangle", "diamond"][modelOrder.indexOf(ml) % 4],
      points: gens
        .filter((g) => (g.s.model.label || g.s.model.id) === ml && g.ttftMs != null && g.promptTokens != null)
        .map((g) => ({ x: g.promptTokens, y: g.ttftMs, tip: tipContent(ml, [["Prompt tokens", String(g.promptTokens)], ["TTFT", fmtMs(g.ttftMs)], ["Prefill", fmtNum(g.prefillTps, 0) + " tok/s"], ["Device", g.s.deviceLabel]]) })),
    })),
    { kind: "scatter", xFormat: (v) => fmtNum(v, 0), xLabel: "prompt tokens", yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + "s" : Math.round(v) + "ms") },
  );

  // 6. Load time: cache vs download
  const byModelLoad = groupBy(loaded, (s) => `${s.model.label || s.model.id} · ${s.deviceLabel || "?"}`);
  const loadRows = Object.entries(byModelLoad).map(([label, ss]) => {
    const c = ss.filter((s) => s.load.cachedBefore > 0.97).map((s) => s.load.totalMs);
    const d = ss.filter((s) => !(s.load.cachedBefore > 0.97)).map((s) => s.load.totalMs);
    const mbps = median(ss.map((s) => s.load.downloadMBps));
    return {
      label,
      values: [median(c), median(d)],
      fmt: (v) => fmtMs(v),
      tip: tipContent(label, [
        ["From cache (median)", `${fmtMs(median(c))} · ${c.length} loads`],
        ["With download (median)", `${fmtMs(median(d))} · ${d.length} loads`],
        ["Download speed", mbps ? fmtNum(mbps) + " MB/s" : "–"],
        ["Shader/GPU setup", fmtMs(median(ss.map((s) => (s.load.phases ? (s.load.phases.shaders || 0) + (s.load.phases.other || 0) : null))))],
      ]),
    };
  });
  groupedHBarChart(
    card("Model load time", "Median time from pressing Load to ready. Cached loads read from OPFS; others include the download."),
    loadRows,
    [
      { label: "From cache", color: colorVar(0) },
      { label: "With download", color: colorVar(1) },
    ],
  );

  // ---------- Group-by summary table ----------
  page.append(h("h2", null, "Summary"));
  const groupSel = h(
    "select",
    { class: "select", id: "g-by" },
    Object.entries(GROUPS).map(([k, g]) => h("option", { value: k, selected: k === state.groupBy ? true : null }, g.label)),
  );
  groupSel.onchange = () => {
    state.groupBy = groupSel.value;
    rerender();
  };
  page.append(h("div", { class: "filters" }, h("label", { for: "g-by" }, "Group by"), groupSel));
  const gfn = GROUPS[state.groupBy].key;
  const groups = groupBy(filtered, gfn);
  const rows = Object.entries(groups).map(([key, ss]) => {
    const gg = ss.flatMap((s) => s.generations.filter((g) => !g.error));
    const dv = gg.map((g) => g.decodeTps);
    const ld = ss.filter((s) => s.load && s.load.totalMs != null && s.status !== "load-failed");
    return {
      key,
      sessions: ss.length,
      replies: gg.length,
      tokens: gg.reduce((a, g) => a + (g.completionTokens || 0), 0),
      decodeMedian: median(dv),
      decodeP10: percentile(dv, 10),
      decodeP90: percentile(dv, 90),
      prefillMedian: median(gg.map((g) => g.prefillTps)),
      ttftMedian: median(gg.map((g) => g.ttftMs)),
      loadCached: median(ld.filter((s) => s.load.cachedBefore > 0.97).map((s) => s.load.totalMs)),
      loadDl: median(ld.filter((s) => !(s.load.cachedBefore > 0.97)).map((s) => s.load.totalMs)),
      failures: ss.filter((s) => s.status === "load-failed").length + ss.reduce((a, s) => a + (s.errors ? s.errors.length : 0), 0),
    };
  });
  const cols = [
    ["key", GROUPS[state.groupBy].label, (v) => v, false],
    ["sessions", "Sessions", (v) => fmtNum(v, 0), true],
    ["replies", "Replies", (v) => fmtNum(v, 0), true],
    ["tokens", "Tokens", (v) => fmtNum(v, 0), true],
    ["decodeMedian", "Decode tok/s", (v) => fmtNum(v), true],
    ["decodeP10", "p10", (v) => fmtNum(v), true],
    ["decodeP90", "p90", (v) => fmtNum(v), true],
    ["prefillMedian", "Prefill tok/s", (v) => fmtNum(v, 0), true],
    ["ttftMedian", "TTFT", fmtMs, true],
    ["loadCached", "Load (cache)", fmtMs, true],
    ["loadDl", "Load (download)", fmtMs, true],
    ["failures", "Failures", (v) => fmtNum(v, 0), true],
  ];
  const { key: sk, dir } = state.sort;
  rows.sort((a, b) => {
    const x = a[sk];
    const y = b[sk];
    if (x == null) return 1;
    if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
  page.append(
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            cols.map(([k, label, , num]) =>
              h(
                "th",
                { class: num ? "num" : null, "aria-sort": sk === k ? (dir > 0 ? "ascending" : "descending") : null },
                h(
                  "button",
                  {
                    class: "sort",
                    type: "button",
                    onclick: () => {
                      state.sort = { key: k, dir: sk === k ? -dir : num ? -1 : 1 };
                      rerender();
                    },
                  },
                  label + (sk === k ? (dir > 0 ? " ↑" : " ↓") : ""),
                ),
              ),
            ),
          ),
        ),
        h(
          "tbody",
          null,
          rows.map((r) => h("tr", null, cols.map(([k, , f, num]) => h("td", { class: num ? "num" : null }, f(r[k]))))),
        ),
      ),
    ),
  );

  // ---------- Sessions table ----------
  page.append(h("h2", null, `Sessions (${filtered.length})`));
  const sessRows = filtered.slice(0, 300).map((s) => {
    const gg = s.generations.filter((g) => !g.error);
    const tr = h(
      "tr",
      { class: "clickable", tabindex: "0" },
      h("td", null, fmtDate(s.startedAt)),
      h("td", null, s.deviceLabel || "?", s.importedAt ? h("span", { class: "muted" }, " (imported)") : null),
      h("td", null, s.model.label || s.model.id),
      h("td", { class: "num" }, String(gg.length)),
      h("td", { class: "num" }, fmtNum(median(gg.map((g) => g.decodeTps)))),
      h("td", { class: "num" }, fmtMs(s.load ? s.load.totalMs : null)),
      h("td", null, statusText(s)),
    );
    const open = () => sessionDetails(s, async () => {
      await deleteSession(s.id);
      toast("Session deleted");
      rerender();
    }, app);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => e.key === "Enter" && open());
    return tr;
  });
  page.append(
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h(
          "thead",
          null,
          h("tr", null, ["Started", "Device", "Model", "Replies", "Decode tok/s", "Load", "Status"].map((t, i) => h("th", { class: i >= 3 && i <= 5 ? "num" : null }, t))),
        ),
        h("tbody", null, sessRows),
      ),
    ),
  );
  if (filtered.length > 300) page.append(h("p", { class: "muted" }, `Showing the latest 300 of ${filtered.length}. Narrow the filters or export to see everything.`));

  page.append(
    h(
      "div",
      { class: "row", style: "margin-top:16px" },
      h(
        "button",
        {
          class: "btn btn-danger",
          type: "button",
          onclick: async () => {
            if (!(await confirmDialog(`Delete ${filtered.length} sessions?`, "All sessions matching the current filters are removed from this browser."))) return;
            const current = app.llm.session ? app.llm.session.id : null;
            for (const s of filtered) if (s.id !== current) await deleteSession(s.id);
            toast("Deleted");
            rerender();
          },
        },
        "Delete filtered sessions",
      ),
    ),
  );
}

// Pick an axis label format that fits the time span shown.
function timeFormatter(times) {
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
  if (span < 2 * 86400000) return (t) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusText(s) {
  if (s.status === "load-failed") return "Load failed";
  if (s.errors && s.errors.length) return `${s.errors.length} error(s)`;
  if (!s.endedAt) return s.status === "loading" ? "Interrupted while loading" : "Active / not closed";
  return "OK";
}

function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) (out[fn(x)] ||= []).push(x);
  return out;
}

function sessionDetails(s, onDelete, app) {
  const d = s.device || {};
  const gens = s.generations || [];
  const body = h(
    "div",
    null,
    h(
      "dl",
      { class: "kv" },
      h("dt", null, "Model"),
      h("dd", null, `${s.model.label || ""} (${s.model.id})`),
      h("dt", null, "Device"),
      h("dd", null, `${s.deviceLabel} · ${d.browser} ${d.browserVersion} · ${d.os} ${d.osVersion || ""}`),
      h("dt", null, "GPU"),
      h("dd", null, gpuLabel(d.gpu)),
      h("dt", null, "Hardware"),
      h("dd", null, `${d.cores ?? "?"} cores · ${d.deviceMemoryGB ? "≥" + d.deviceMemoryGB + " GB RAM" : "RAM not exposed"} · ${d.screen ? `${d.screen.w}×${d.screen.h}@${d.screen.dpr}x` : ""}`),
      h("dt", null, "Started"),
      h("dd", null, `${fmtDate(s.startedAt)}${s.endedAt ? " · lasted " + fmtMs(s.endedAt - s.startedAt) : ""}`),
      h("dt", null, "Load"),
      h(
        "dd",
        null,
        s.load
          ? `${fmtMs(s.load.totalMs)} · ${s.load.cachedBefore > 0.97 ? "from cache" : "downloaded " + fmtBytes(s.load.downloadBytes)}${s.load.downloadMBps ? ` at ${s.load.downloadMBps} MB/s` : ""}`
          : "–",
      ),
      s.load && s.load.phases ? [h("dt", null, "Load phases"), h("dd", null, Object.entries(s.load.phases).map(([k, v]) => `${k} ${fmtMs(v)}`).join(" · ") || "–")] : null,
      s.load && s.load.error ? [h("dt", null, "Load error"), h("dd", { style: "color:var(--critical-ink)" }, s.load.error)] : null,
      s.batteryStart ? [h("dt", null, "Battery"), h("dd", null, `${s.batteryStart.level}%${s.batteryStart.charging ? " charging" : ""}${s.batteryEnd ? ` → ${s.batteryEnd.level}%` : ""}`)] : null,
      s.errors && s.errors.length ? [h("dt", null, "Errors"), h("dd", null, s.errors.map((e) => h("div", null, `${fmtDate(e.at)} ${e.kind}: ${e.message}`)))] : null,
    ),
  );
  if (gens.length) {
    body.append(
      h("h2", { style: "font-size:15px;margin:18px 0 8px" }, "Replies"),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table" },
          h("thead", null, h("tr", null, ["#", "Prompt tok", "Output tok", "Decode tok/s", "Wall tok/s", "Prefill tok/s", "TTFT", "Total", "Context", "End"].map((t, i) => h("th", { class: i ? "num" : null }, t)))),
          h(
            "tbody",
            null,
            gens.map((g, i) =>
              h(
                "tr",
                null,
                h("td", null, String(i + 1)),
                h("td", { class: "num" }, fmtNum(g.promptTokens, 0)),
                h("td", { class: "num" }, fmtNum(g.completionTokens, 0)),
                h("td", { class: "num" }, fmtNum(g.decodeTps)),
                h("td", { class: "num" }, fmtNum(g.wallDecodeTps)),
                h("td", { class: "num" }, fmtNum(g.prefillTps, 0)),
                h("td", { class: "num" }, fmtMs(g.ttftMs)),
                h("td", { class: "num" }, fmtMs(g.e2eMs)),
                h("td", { class: "num" }, `${g.contextTokens ?? "–"}/${g.contextWindow ?? "–"}`),
                h("td", { class: "num" }, g.error ? "error" : g.finishReason || ""),
              ),
            ),
          ),
        ),
      ),
    );
    const series = gens.filter((g) => g.windowTps && g.windowTps.length > 1).slice(-6);
    if (series.length) {
      const c = h("div", { style: "margin-top:12px" });
      body.append(h("h2", { style: "font-size:15px;margin:18px 0 4px" }, "Speed through each reply"), c);
      setTimeout(
        () =>
          xyChart(
            c,
            series.map((g, i) => ({
              name: `Reply ${gens.indexOf(g) + 1}`,
              color: colorVar(i),
              points: g.windowTps.map((v, j) => ({ x: (j + 1) * 16, y: v })),
            })),
            { kind: "line", xFormat: (v) => fmtNum(v, 0), xLabel: "token position", yFormat: (v) => fmtNum(v, 0) },
          ),
        30,
      );
    }
  }
  const raw = h("details", { style: "margin-top:16px" }, h("summary", null, "Raw JSON"), h("pre", { class: "mono", style: "white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto" }, JSON.stringify(s, null, 1)));
  body.append(raw);
  const isCurrent = app.llm.session && app.llm.session.id === s.id;
  body.append(
    h(
      "div",
      { class: "row", style: "margin-top:16px;justify-content:flex-end" },
      h(
        "button",
        {
          class: "btn btn-danger",
          type: "button",
          disabled: isCurrent ? true : null,
          title: isCurrent ? "This session is still running" : null,
          onclick: async () => {
            if (!(await confirmDialog("Delete session?", "This session's stats are removed from this browser."))) return;
            dlg.close();
            onDelete();
          },
        },
        "Delete session",
      ),
    ),
  );
  const dlg = modal(`${s.model.label || s.model.id} · ${fmtDate(s.startedAt)}`, body);
}

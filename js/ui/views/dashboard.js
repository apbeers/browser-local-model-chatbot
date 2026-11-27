// Stats dashboard: reads every session record from OPFS (own + imported),
// filters, shows summary numbers, then charts (dashboard-charts.js) and
// tables (dashboard-tables.js). Export/import JSON to compare devices.
import { app } from "../../core/api.js";
import { h, toast, fmtNum, fmtMs, downloadFile, pickFile } from "../dom.js";
import { colorVar, disposeCharts } from "../charts.js";
import { renderCharts } from "./dashboard-charts.js";
import { renderTables } from "./dashboard-tables.js";
import { renderMemory } from "./dashboard-memory.js";
import { renderTimeline, setTimelineFocus } from "./dashboard-timeline.js";

const { loadAllSessions, exportSessions, importBundle, median, percentile } = app.stats;

const RANGES = [
  ["all", "All time", Infinity],
  ["1d", "24 hours", 86400000],
  ["7d", "7 days", 7 * 86400000],
  ["30d", "30 days", 30 * 86400000],
];
const KINDS = [
  ["all", "Everything"],
  ["chat", "Chats"],
  ["benchmark", "Benchmarks"],
  ["builder", "Studio / themes"],
];

// Filter choices survive re-renders while the page is open.
const state = { model: "all", device: "all", range: "all", project: "all", kind: "all", groupBy: "modelDevice", sort: { key: "decodeMedian", dir: -1 } };

// "chat" | "benchmark" | "warmup" | "builder" for a generation record.
function kindOf(g) {
  const k = g.kind || "chat";
  if (k.startsWith("builder")) return "builder";
  if (k === "benchmark-warmup") return "warmup";
  return k;
}

// args: ["timeline", <time>] centers the memory timeline on that moment.
export async function render(root, args = []) {
  if (args[0] === "timeline" && args[1]) setTimelineFocus(Number(args[1]));
  disposeCharts();
  const page = h("div", { class: "page" });
  root.replaceChildren(page);
  const rerender = () => render(root);
  const all = await loadAllSessions();
  const projects = await app.projects.listProjects();
  let filtered = [];

  page.append(
    h(
      "div",
      { class: "row", style: "align-items:flex-start" },
      h(
        "div",
        { style: "flex:1;min-width:220px" },
        h("h1", null, "Stats dashboard"),
        h("p", { class: "lede" }, "Every model session on this device is logged as it runs. Import exports from other devices to compare them here."),
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
              let added = 0;
              let skipped = 0;
              for (const f of await pickFile()) {
                try {
                  const r = await importBundle(JSON.parse(await f.text()));
                  added += r.added;
                  skipped += r.skipped;
                } catch (e) {
                  toast(`${f.name}: ${e.message}`, 4000);
                }
              }
              toast(`Imported ${added} sessions${skipped ? `, skipped ${skipped} duplicates` : ""}`);
              rerender();
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
              const label = (bundle.exportedBy.label || "device").replace(/[^\w-]+/g, "_");
              downloadFile(`llm-stats-${label}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 1));
            },
          },
          "Export JSON",
        ),
      ),
    ),
  );
  if (!all.length) {
    page.append(h("div", { class: "card" }, "No sessions recorded yet. Load a model and chat, or run a benchmark. Every reply is logged here."));
    renderMemory(page, { filtered: [] });
    await renderTimeline(page);
    return;
  }

  // ---------- Filters ----------
  const sel = (id, label, options, key) => {
    const el = h("select", { class: "select", id }, options.map(([v, l]) => h("option", { value: v, selected: v === state[key] ? true : null }, l)));
    el.onchange = () => ((state[key] = el.value), rerender());
    return h("span", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, h("label", { for: id }, label), el);
  };
  const models = [...new Set(all.map((s) => s.model.label || s.model.id))];
  const devices = [...new Set(all.map((s) => s.deviceLabel || "unknown"))];
  page.append(
    h(
      "div",
      { class: "filters" },
      sel("f-model", "Model", [["all", "All models"], ...models.map((m) => [m, m])], "model"),
      sel("f-device", "Device", [["all", "All devices"], ...devices.map((d) => [d, d])], "device"),
      sel("f-project", "Project", [["all", "All"], ["none", "No project"], ...projects.map((p) => [p.id, p.name])], "project"),
      sel("f-kind", "Type", KINDS, "kind"),
      sel("f-range", "Time", RANGES, "range"),
    ),
  );

  const span = RANGES.find((r) => r[0] === state.range)[2];
  const now = Date.now();
  const gensOf = (s) =>
    s.generations.filter(
      (g) =>
        !g.error &&
        kindOf(g) !== "warmup" &&
        (state.kind === "all" || kindOf(g) === state.kind) &&
        (state.project === "all" || (state.project === "none" ? !g.projectId : g.projectId === state.project)),
    );
  const genFilterOn = state.kind !== "all" || state.project !== "all";
  filtered = all.filter(
    (s) =>
      (state.model === "all" || (s.model.label || s.model.id) === state.model) &&
      (state.device === "all" || (s.deviceLabel || "unknown") === state.device) &&
      now - s.startedAt <= span &&
      (!genFilterOn || gensOf(s).length > 0),
  );
  const gens = filtered.flatMap((s) => gensOf(s).map((g) => ({ ...g, s })));
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
      kpi("Load from storage", fmtMs(median(cachedLoads)), `${cachedLoads.length} loads`),
      kpi("Load + download", fmtMs(median(dlLoads)), `${dlLoads.length} loads`),
      kpi("Failures", fmtNum(failures, 0), "failed loads + errors"),
      kpi("Peak GPU memory", (() => {
        const v = median(gens.map((g) => g.gpuPeakMB).filter(Boolean));
        return v ? `${fmtNum(v, 0)} <small>MB</small>` : "–";
      })(), "median while replying (measured)"),
    ),
  );

  // Stable color per model: catalog order, then first-seen order. Only models
  // with data get a slot, so the most distinct colors are used first.
  const catalogOrder = app.catalog ? app.catalog.quick.map((m) => m.label) : [];
  const present = [...new Set(filtered.map((s) => s.model.label || s.model.id))];
  const modelOrder = [...catalogOrder.filter((l) => present.includes(l)), ...present.filter((l) => !catalogOrder.includes(l))];
  const modelColor = (label) => colorVar(Math.max(0, modelOrder.indexOf(label)));

  renderMemory(page, { filtered });
  await renderTimeline(page);
  renderCharts(page, { gens, loaded, modelOrder, modelColor });
  renderTables(page, { filtered, gensOf, rerender, state });
}

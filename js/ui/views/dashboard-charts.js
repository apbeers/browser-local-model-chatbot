// Dashboard charts (part of the Stats dashboard, see dashboard.js).
// renderCharts(page, data) appends the chart cards. data:
//   gens       generation records, each with .s = its session
//   loaded     sessions whose model loaded
//   modelOrder model labels in color order; modelColor(label) -> CSS color
import { h, fmtNum, fmtMs, fmtDate } from "../dom.js";
import { app } from "../../core/api.js";
import { hBarChart, groupedHBarChart, xyChart, colorVar, tipContent } from "../charts.js";

const { median, percentile } = app.stats;
const { fmtBytes } = app.models;

export function renderCharts(page, { gens, loaded, modelOrder, modelColor }) {
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

}

function timeFormatter(times) {
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
  if (span < 2 * 86400000) return (t) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}


function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) (out[fn(x)] ||= []).push(x);
  return out;
}


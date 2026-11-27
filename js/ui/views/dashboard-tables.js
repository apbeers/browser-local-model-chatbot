// Dashboard tables (part of the Stats dashboard, see dashboard.js): the
// group-by summary, the sessions list and the session details dialog.
// renderTables(page, { filtered, gensOf, rerender, state }):
//   filtered  sessions that match the filters
//   gensOf(s) the session's generations that match the filters
import { app } from "../../core/api.js";
import { h, toast, confirmDialog, modal, fmtNum, fmtMs, fmtDate } from "../dom.js";
import { xyChart, colorVar } from "../charts.js";

const { deleteSession, median, percentile } = app.stats;
const { fmtBytes } = app.models;
const { gpuLabel } = app.device;

export const GROUPS = {
  model: { label: "Model", key: (s) => s.model.label || s.model.id },
  device: { label: "Device", key: (s) => s.deviceLabel || "unknown" },
  modelDevice: { label: "Model × device", key: (s) => `${s.model.label || s.model.id} · ${s.deviceLabel || "?"}` },
  browser: { label: "Browser", key: (s) => `${s.device.browser} ${s.device.browserVersion}` },
  os: { label: "OS", key: (s) => s.device.os || "?" },
  gpu: { label: "GPU", key: (s) => gpuLabel(s.device.gpu) },
  day: { label: "Day", key: (s) => new Date(s.startedAt).toISOString().slice(0, 10) },
};

export function renderTables(page, { filtered, gensOf, rerender, state }) {
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
    const gg = ss.flatMap((s) => gensOf(s));
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
      gpuPeak: median(gg.map((g) => g.gpuPeakMB).filter(Boolean)),
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
    ["gpuPeak", "GPU peak", (v) => (v ? fmtNum(v, 0) + " MB" : "–"), true],
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
    const gg = gensOf(s);
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
    const open = () =>
      sessionDetails(s, async () => {
        await deleteSession(s.id);
        toast("Session deleted");
        rerender();
      });
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


function sessionDetails(s, onDelete) {
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
      s.load && s.load.gpuMB ? [h("dt", null, "GPU memory"), h("dd", null, `${s.load.gpuMB} MB after loading (measured)`)] : null,
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
          h("thead", null, h("tr", null, ["#", "Prompt tok", "Output tok", "Decode tok/s", "Wall tok/s", "Prefill tok/s", "TTFT", "Total", "Context", "GPU peak", "End"].map((t, i) => h("th", { class: i ? "num" : null }, t)))),
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
                h("td", { class: "num" }, g.gpuPeakMB ? `${g.gpuPeakMB} MB` : "–"),
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


// Stats dashboard, "Memory timeline": GPU memory per model over time, what you
// were doing (from the usage log) and crashes, on one chart, plus a log table.
// Opened at #/dashboard/timeline/<time> it centers on that moment (used by the
// "ran out of memory" popup).
import { app } from "../../core/api.js";
import { h, fmtDate } from "../dom.js";
import { colorVar } from "../charts.js";
import { timelineChart } from "../timeline-chart.js";

const RANGES = [
  ["10s", "10 sec", 10000],
  ["30s", "30 sec", 30000],
  ["10m", "10 min", 10 * 60000],
  ["1h", "1 hour", 3600000],
  ["6h", "6 hours", 6 * 3600000],
  ["24h", "24 hours", 86400000],
  ["7d", "7 days", 7 * 86400000],
];
let rangeKey = "6h";
let focus = null; // a moment to center on
let liveTimer = null; // short ranges ending now refresh themselves

const PAGE_NAMES = { chat: "Chat", models: "Models", dashboard: "Stats", benchmark: "Benchmark", studio: "Studio", storage: "Storage", settings: "Settings", run: "an app" };

// Usage-log event -> [text, color] for the actions lane (null = not shown).
function describe(e) {
  const C = { page: "var(--muted)", model: "var(--s1)", reply: "var(--s3)", studio: "var(--s7)", app: "var(--s2)", other: "var(--s5)" };
  switch (e.e) {
    case "page":
      return [`Opened ${PAGE_NAMES[e.page] || e.page}`, C.page];
    case "model-load":
      return [`Loaded ${e.model}${e.ms ? ` (${(e.ms / 1000).toFixed(1)} s)` : ""}`, C.model];
    case "model-unload":
      return [`Unloaded ${e.model} (${e.reason})`, C.model];
    case "generation":
      return [`${e.kind === "chat" ? "Chat reply" : e.kind && e.kind.startsWith("builder") ? "Studio model step" : (e.kind || "Model") + " reply"} (${e.tokens ?? "?"} tokens${e.ms ? `, ${(e.ms / 1000).toFixed(1)} s` : ""})`, C.reply];
    case "studio-request":
      return ["Asked the Studio agent", C.studio];
    case "studio-step":
      return [`Studio: ${e.label}`, C.studio];
    case "studio-accept":
      return ["Kept a Studio draft", C.studio];
    case "studio-new-app":
      return ["Started a new app", C.studio];
    case "app-run":
      return ["Opened an app", C.app];
    case "app-pin":
      return ["Pinned an app", C.app];
    case "tools-used":
      return [`Used tools: ${(e.tools || []).join(", ")}`, C.other];
    case "tools-mode":
      return [`Tools set to ${e.mode}`, C.other];
    case "theme":
      return ["Changed the theme", C.other];
    case "personalize":
      return ["Customize for me", C.studio];
    case "out-of-memory":
      return null; // drawn as a crash
    default:
      return null;
  }
}

const crashText = (c) => `${{ "out-of-memory": "Out of GPU memory", "load-failed": "Model failed to load", "reply-failed": "Reply failed", "page-error": "Page error" }[c.kind] || c.kind}: ${c.msg}`;

export function setTimelineFocus(t) {
  focus = t;
  rangeKey = "10m"; // zoom in on the moment (e.g. a crash)
}

export async function renderTimeline(page) {
  const card = h("div", { class: "chart-card", id: "memory-timeline" });
  page.append(h("h2", null, "Memory timeline"), card);
  const body = h("div");
  const log = h("div");
  const bar = h("div", { class: "row", style: "margin-bottom:8px" });

  async function draw() {
    const span = (RANGES.find((r) => r[0] === rangeKey) || RANGES[4])[2];
    // Centered on a moment: show mostly what led up to it.
    const to = focus ? Math.min(Date.now(), focus + span / 4) : Date.now();
    const from = focus ? Math.min(to, focus + span / 4) - span : to - span;
    const [lines, usageEv] = await Promise.all([app.timeline.read({ from: from - 3600000, to }), app.usage.readEvents({ months: 2 })]);
    const mem = lines.filter((l) => l.e === "mem");
    const crashes = lines.filter((l) => l.e === "crash" && l.t >= from && l.t <= to);

    // One line per model: per window, memory goes to 0 for a model when it's replaced or unloaded.
    const byModel = {};
    const current = {}; // window -> label
    for (const l of mem) {
      const prev = current[l.w];
      if (prev && prev !== l.label) (byModel[prev] ||= []).push({ t: l.t, mb: 0 });
      if (l.label) (byModel[l.label] ||= []).push({ t: l.t, mb: l.gpuMB });
      current[l.w] = l.label;
    }
    const names = Object.keys(byModel);
    const series = names.map((name, i) => ({ name, color: colorVar(i), points: byModel[name] }));
    const events = usageEv
      .filter((e) => e.t >= from && e.t <= to)
      .map((e) => {
        const d = describe(e);
        return d ? { t: e.t, text: d[0], color: d[1], raw: e } : null;
      })
      .filter(Boolean);

    bar.replaceChildren(
      ...RANGES.map(([k, label]) =>
        h(
          "button",
          {
            type: "button",
            class: "btn btn-sm" + (k === rangeKey ? " btn-primary" : ""),
            onclick: () => {
              rangeKey = k;
              draw();
            },
          },
          label,
        ),
      ),
      focus
        ? h(
            "button",
            {
              type: "button",
              class: "btn btn-sm",
              onclick: () => {
                focus = null;
                draw();
              },
            },
            "Back to now",
          )
        : null,
      h("span", { class: "spacer" }),
      h("span", { class: "note" }, focus ? `Centered on ${fmtDate(focus)}` : "Up to now"),
    );
    timelineChart(body, { from, to, series, events, crashes: crashes.map((c) => ({ t: c.t, text: crashText(c) })) });

    // Log table: actions and crashes with the GPU memory in use at that moment.
    // Memory in use just before a moment (a crash unloads everything in the same instant).
    const memAt = (t, crash) => {
      const perWindow = {};
      for (const l of mem) if (crash ? l.t < t - 50 : l.t <= t) perWindow[l.w] = l;
      return Object.values(perWindow).filter((l) => l.label && l.gpuMB);
    };
    const rows = [...events.map((e) => ({ ...e, crash: false })), ...crashes.map((c) => ({ t: c.t, text: crashText(c), crash: true }))].sort((a, b) => b.t - a.t).slice(0, 300);
    log.replaceChildren(
      h(
        "details",
        { open: crashes.length ? true : null },
        h("summary", null, `Log (${rows.length}${crashes.length ? `, ${crashes.length} crash${crashes.length === 1 ? "" : "es"}` : ""})`),
        h(
          "div",
          { class: "table-wrap", style: "margin-top:8px;max-height:420px;overflow:auto" },
          h(
            "table",
            { class: "table" },
            h("thead", null, h("tr", null, h("th", null, "Time"), h("th", null, "What happened"), h("th", null, "GPU memory then"))),
            h(
              "tbody",
              null,
              rows.map((r) =>
                h(
                  "tr",
                  { class: r.crash ? "tl-crash" : null },
                  h("td", null, new Date(r.t).toLocaleTimeString()),
                  h("td", { style: "white-space:normal" }, r.crash ? "⚠ " + r.text : r.text),
                  h("td", { style: "white-space:normal" }, memAt(r.t, r.crash).map((l) => `${l.label} ${l.gpuMB} MB`).join(", ") || "none"),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // 10 s / 30 s views of "now" redraw every 2 s so they stay live.
  clearInterval(liveTimer);
  liveTimer = setInterval(() => {
    if (!document.body.contains(card)) return clearInterval(liveTimer);
    const span = (RANGES.find((r) => r[0] === rangeKey) || RANGES[0])[2];
    if (!focus && span <= 60000 && document.visibilityState === "visible") draw();
  }, 2000);

  card.append(
    h("p", { class: "sub" }, "GPU memory used by each model over time, with what you were doing (dots under the chart) and crashes (red). Hover for details. Kept for 30 days on this device."),
    bar,
    body,
    log,
  );
  await draw();
  if (focus) card.scrollIntoView({ block: "start" });
}

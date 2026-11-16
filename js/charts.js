// Hand-rolled responsive SVG charts (no dependencies).
// Colors come from CSS custom properties (--s1..--s8) so light/dark mode swap
// automatically. Every chart has a hover tooltip; identity is never color-only
// (legends + marker shapes).

import { h, s } from "./ui.js";

export const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"];
export const colorVar = (i) => `var(${SERIES[i % SERIES.length]})`;
const SHAPES = ["circle", "square", "triangle", "diamond"];

let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = h("div", { class: "tooltip", hidden: true });
    document.body.append(tipEl);
  }
  return tipEl;
}
export function showTip(evt, content) {
  const t = tip();
  t.innerHTML = "";
  t.append(content);
  t.hidden = false;
  const pad = 14;
  const r = t.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - pad;
  t.style.left = Math.max(8, x) + "px";
  t.style.top = Math.max(8, y) + "px";
}
export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

export function tipContent(title, rows) {
  return h(
    "div",
    null,
    h("div", { class: "tt-title" }, title),
    rows.map(([label, value, color]) =>
      h("div", { class: "tt-row" }, h("span", null, color ? h("i", { style: `background:${color}` }) : null, label), h("strong", null, value)),
    ),
  );
}

// "Nice" axis ticks
function niceTicks(min, max, count = 5) {
  if (!(max > min)) {
    max = min + 1;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

function fmtTick(v) {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k";
  return String(+v.toFixed(2));
}

export function legend(items) {
  return h(
    "div",
    { class: "legend" },
    items.map((it) => h("span", null, h("i", { style: `background:${it.color}` }), it.label)),
  );
}

function marker(shape, x, y, color, r = 4.5) {
  const style = `fill:${color}`;
  if (shape === "square") return s("rect", { x: x - r, y: y - r, width: r * 2, height: r * 2, rx: 1.5, class: "dot", style });
  if (shape === "triangle") return s("path", { d: `M${x},${y - r * 1.2} L${x + r * 1.15},${y + r * 0.85} L${x - r * 1.15},${y + r * 0.85} Z`, class: "dot", style });
  if (shape === "diamond") return s("path", { d: `M${x},${y - r * 1.25} L${x + r * 1.25},${y} L${x},${y + r * 1.25} L${x - r * 1.25},${y} Z`, class: "dot", style });
  return s("circle", { cx: x, cy: y, r, class: "dot", style });
}

const observers = [];
export function disposeCharts() {
  while (observers.length) observers.pop().disconnect();
  hideTip();
}

// Re-render on container resize.
function responsive(container, draw) {
  let lastW = 0;
  const run = () => {
    const w = Math.max(260, Math.floor(container.clientWidth));
    if (w === lastW) return;
    lastW = w;
    container.innerHTML = "";
    draw(w);
  };
  const ro = new ResizeObserver(() => run());
  ro.observe(container);
  observers.push(ro);
  run();
  return ro;
}

/**
 * Horizontal bar chart with optional p10–p90 range whisker.
 * rows: [{label, value, lo?, hi?, tip: Node}]
 */
export function hBarChart(container, rows, { unit = "", color = colorVar(0) } = {}) {
  container.classList.add("chart");
  if (!rows.length) {
    container.append(h("div", { class: "chart-empty" }, "No data yet"));
    return;
  }
  responsive(container, (W) => {
    // Label sits above each bar so long "model · device" names never clip.
    const rowH = 40;
    const top = 2;
    const bottom = 22;
    const left = 2;
    const right = 52;
    const H = top + rows.length * rowH + bottom;
    const maxV = Math.max(...rows.map((r) => Math.max(r.value || 0, r.hi || 0)));
    const { hi, ticks } = niceTicks(0, maxV || 1, W < 420 ? 3 : 5);
    const x = (v) => left + (v / hi) * (W - left - right);
    const maxChars = Math.floor((W - 8) / 6.4);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (const t of ticks) {
      svg.append(s("line", { x1: x(t), x2: x(t), y1: top, y2: H - bottom, class: t === 0 ? "baseline" : "gridline" }));
      svg.append(s("text", { x: x(t), y: H - 6, "text-anchor": t === 0 ? "start" : "middle", class: "tick" }, fmtTick(t)));
    }
    rows.forEach((r, i) => {
      const y = top + i * rowH;
      const barH = 12;
      const cy = y + 25;
      const label = r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + "…" : r.label;
      svg.append(s("text", { x: left, y: y + 12, class: "label" }, label));
      const w = Math.max(1, x(r.value || 0) - x(0));
      // Bar with 4px rounded data-end, square at the baseline.
      const x0 = x(0);
      const rr = Math.min(4, w / 2, barH / 2);
      svg.append(
        s("path", {
          d: `M${x0},${cy - barH / 2} H${x0 + w - rr} Q${x0 + w},${cy - barH / 2} ${x0 + w},${cy - barH / 2 + rr} V${cy + barH / 2 - rr} Q${x0 + w},${cy + barH / 2} ${x0 + w - rr},${cy + barH / 2} H${x0} Z`,
          style: `fill:${r.color || color}`,
        }),
      );
      if (r.lo != null && r.hi != null && r.hi > r.lo) {
        const ws = "stroke:var(--ink);stroke-width:1.5;opacity:.55";
        svg.append(s("line", { x1: x(r.lo), x2: x(r.hi), y1: cy, y2: cy, style: ws }));
        for (const v of [r.lo, r.hi]) svg.append(s("line", { x1: x(v), x2: x(v), y1: cy - 4, y2: cy + 4, style: ws }));
      }
      svg.append(s("text", { x: Math.max(x(r.value || 0), r.hi != null ? x(r.hi) : 0) + 6, y: cy + 4, class: "value-label" }, fmtTick(+(r.value || 0).toFixed(1)) + unit));
      const hit = s("rect", { x: 0, y, width: W, height: rowH, class: "hit" });
      hit.addEventListener("pointermove", (e) => r.tip && showTip(e, r.tip));
      hit.addEventListener("pointerleave", hideTip);
      svg.append(hit);
    });
    container.append(svg);
  });
}

/**
 * Grouped horizontal bars: rows × groups (e.g. model × [cached, download]).
 * rows: [{label, values: [v|null...], tips: [Node...]}], groups: [{label, color}]
 */
export function groupedHBarChart(container, rows, groups, { unit = "" } = {}) {
  container.classList.add("chart");
  if (!rows.length) {
    container.append(h("div", { class: "chart-empty" }, "No data yet"));
    return;
  }
  container.append(legend(groups));
  const holder = h("div");
  container.append(holder);
  responsive(holder, (W) => {
    const barH = 12;
    const gap = 2;
    const labelH = 16;
    const rowH = labelH + groups.length * (barH + gap) + 10;
    const top = 2;
    const bottom = 22;
    const left = 2;
    const right = 60;
    const H = top + rows.length * rowH + bottom;
    const maxV = Math.max(1, ...rows.flatMap((r) => r.values.filter((v) => v != null)));
    const { hi, ticks } = niceTicks(0, maxV, W < 420 ? 3 : 5);
    const x = (v) => left + (v / hi) * (W - left - right);
    const maxChars = Math.floor((W - 8) / 6.4);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (const t of ticks) {
      svg.append(s("line", { x1: x(t), x2: x(t), y1: top, y2: H - bottom, class: t === 0 ? "baseline" : "gridline" }));
      svg.append(s("text", { x: x(t), y: H - 6, "text-anchor": t === 0 ? "start" : "middle", class: "tick" }, r_fmt(t)));
    }
    function r_fmt(t) {
      return rows[0] && rows[0].fmt ? rows[0].fmt(t) : fmtTick(t);
    }
    rows.forEach((r, i) => {
      const y0 = top + i * rowH;
      const label = r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + "…" : r.label;
      svg.append(s("text", { x: left, y: y0 + 12, class: "label" }, label));
      groups.forEach((g, gi) => {
        const v = r.values[gi];
        const by = y0 + labelH + gi * (barH + gap);
        if (v == null) {
          svg.append(s("text", { x: x(0) + 4, y: by + barH - 2, class: "tick" }, "no data"));
          return;
        }
        const w = Math.max(1, x(v) - x(0));
        const rr = Math.min(4, w / 2, barH / 2);
        const x0 = x(0);
        svg.append(
          s("path", {
            d: `M${x0},${by} H${x0 + w - rr} Q${x0 + w},${by} ${x0 + w},${by + rr} V${by + barH - rr} Q${x0 + w},${by + barH} ${x0 + w - rr},${by + barH} H${x0} Z`,
            style: `fill:${g.color}`,
          }),
        );
        svg.append(s("text", { x: x(v) + 6, y: by + barH - 2, class: "value-label" }, r.fmt ? r.fmt(v) : fmtTick(+v.toFixed(1)) + unit));
      });
      const hit = s("rect", { x: 0, y: y0, width: W, height: rowH, class: "hit" });
      hit.addEventListener("pointermove", (e) => r.tip && showTip(e, r.tip));
      hit.addEventListener("pointerleave", hideTip);
      svg.append(hit);
    });
    holder.append(svg);
  });
}

/**
 * XY chart: lines and/or scatter points.
 * series: [{name, color, shape?, points: [{x, y, tip?}]}]
 * opts: {kind: 'line'|'scatter', xFormat, yFormat, xLabel, yLabel, time: bool}
 */
export function xyChart(container, series, opts = {}) {
  container.classList.add("chart");
  const all = series.flatMap((se) => se.points);
  if (!all.length) {
    container.append(h("div", { class: "chart-empty" }, "No data yet"));
    return;
  }
  if (series.length > 1) container.append(legend(series.map((se) => ({ label: se.name, color: se.color }))));
  const holder = h("div");
  container.append(holder);
  const kind = opts.kind || "line";
  const xFormat = opts.xFormat || fmtTick;
  const yFormat = opts.yFormat || fmtTick;
  responsive(holder, (W) => {
    const H = Math.round(Math.min(280, Math.max(200, W * 0.5)));
    const m = { l: 44, r: 14, t: 10, b: 30 };
    let xmin = Math.min(...all.map((p) => p.x));
    let xmax = Math.max(...all.map((p) => p.x));
    if (xmax === xmin) {
      xmin -= 1;
      xmax += 1;
    }
    const ymaxRaw = Math.max(...all.map((p) => p.y));
    const yt = niceTicks(0, ymaxRaw || 1, 4);
    const X = (v) => m.l + ((v - xmin) / (xmax - xmin)) * (W - m.l - m.r);
    const Y = (v) => H - m.b - (v / yt.hi) * (H - m.t - m.b);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (const t of yt.ticks) {
      svg.append(s("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? "baseline" : "gridline" }));
      svg.append(s("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end", class: "tick" }, yFormat(t)));
    }
    // x ticks
    const xcount = W < 420 ? 3 : 5;
    let xticks;
    if (opts.time) {
      xticks = [];
      for (let i = 0; i <= xcount - 1; i++) xticks.push(xmin + ((xmax - xmin) * i) / (xcount - 1));
    } else {
      xticks = niceTicks(xmin, xmax, xcount).ticks.filter((t) => t >= xmin && t <= xmax);
    }
    xticks.forEach((t, i) => {
      const anchor = opts.time ? (i === 0 ? "start" : i === xticks.length - 1 ? "end" : "middle") : "middle";
      svg.append(s("text", { x: X(t), y: H - 10, "text-anchor": anchor, class: "tick" }, xFormat(t)));
    });
    if (opts.xLabel) svg.append(s("text", { x: W - m.r, y: H - m.b - 6, "text-anchor": "end", class: "tick" }, opts.xLabel));

    series.forEach((se, si) => {
      const pts = [...se.points].sort((a, b) => a.x - b.x);
      if (kind === "line" && pts.length > 1) {
        const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
        svg.append(s("path", { d, class: "line", style: `stroke:${se.color}` }));
      }
      if (kind === "scatter" || pts.length <= 1 || opts.markers) {
        const shape = se.shape || SHAPES[si % SHAPES.length];
        for (const p of pts) svg.append(marker(shape, X(p.x), Y(p.y), se.color, kind === "scatter" ? 4.5 : 3.5));
      }
    });

    // Hover: nearest point (scatter) or crosshair at nearest x (line)
    const hoverLine = s("line", { class: "hover-line", y1: m.t, y2: H - m.b, visibility: "hidden" });
    const hoverDots = s("g");
    svg.append(hoverLine, hoverDots);
    const hit = s("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: "hit" });
    hit.addEventListener("pointermove", (e) => {
      const rect = svg.getBoundingClientRect();
      const scale = W / rect.width;
      const px = (e.clientX - rect.left) * scale;
      const py = (e.clientY - rect.top) * scale;
      hoverDots.innerHTML = "";
      if (kind === "scatter") {
        let best = null;
        let bd = Infinity;
        series.forEach((se) =>
          se.points.forEach((p) => {
            const d = (X(p.x) - px) ** 2 + (Y(p.y) - py) ** 2;
            if (d < bd) {
              bd = d;
              best = { p, se };
            }
          }),
        );
        if (best && bd < 40 * 40) {
          hoverDots.append(s("circle", { cx: X(best.p.x), cy: Y(best.p.y), r: 7, style: `fill:none;stroke:${best.se.color};stroke-width:2` }));
          showTip(e, best.p.tip || tipContent(best.se.name, [[xFormat(best.p.x), yFormat(best.p.y)]]));
        } else hideTip();
      } else {
        const xv = xmin + ((px - m.l) / (W - m.l - m.r)) * (xmax - xmin);
        let nearestX = null;
        let bd = Infinity;
        for (const p of all) {
          const d = Math.abs(p.x - xv);
          if (d < bd) {
            bd = d;
            nearestX = p.x;
          }
        }
        hoverLine.setAttribute("x1", X(nearestX));
        hoverLine.setAttribute("x2", X(nearestX));
        hoverLine.setAttribute("visibility", "visible");
        const rows = [];
        series.forEach((se) => {
          const p = se.points.find((q) => q.x === nearestX);
          if (p) {
            rows.push([se.name, yFormat(p.y), se.color]);
            hoverDots.append(s("circle", { cx: X(p.x), cy: Y(p.y), r: 4.5, class: "dot", style: `fill:${se.color}` }));
          }
        });
        showTip(e, tipContent(opts.xTitle ? opts.xTitle(nearestX) : xFormat(nearestX), rows));
      }
    });
    hit.addEventListener("pointerleave", () => {
      hideTip();
      hoverDots.innerHTML = "";
      hoverLine.setAttribute("visibility", "hidden");
    });
    svg.append(hit);
    holder.append(svg);
  });
}

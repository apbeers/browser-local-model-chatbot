// Timeline chart: GPU memory per model over time (step lines), a lane of
// markers for what the user was doing, and red lines for crashes.
// timelineChart(container, {from, to, series, events, crashes})
//   series:  [{name, color, points: [{t, mb}]}]
//   events:  [{t, text, color}]        what you were doing
//   crashes: [{t, text}]               out of memory, failed loads, page errors
import { h, s } from "./dom.js";
import { showTip, hideTip, tipContent, legend } from "./charts.js";

const fmtTime = (t, span) =>
  new Date(t).toLocaleString(undefined, span > 2 * 86400000 ? { month: "short", day: "numeric", hour: "2-digit" } : { hour: "2-digit", minute: "2-digit", second: span < 600000 ? "2-digit" : undefined });

export function timelineChart(container, { from, to, series, events, crashes }) {
  container.replaceChildren();
  if (!series.length && !events.length && !crashes.length) {
    container.append(h("div", { class: "chart-empty" }, "Nothing recorded in this time range."));
    return;
  }
  const items = series.map((x) => ({ label: x.name, color: x.color }));
  items.push({ label: "Crash", color: "var(--critical)" });
  container.append(legend(items));
  const holder = h("div", { class: "chart" });
  container.append(holder);

  let lastW = 0;
  const draw = () => {
    const W = Math.max(300, Math.floor(holder.clientWidth));
    if (W === lastW) return;
    lastW = W;
    const m = { l: 52, r: 12, t: 12, b: 54 };
    const H = Math.round(Math.min(340, Math.max(240, W * 0.42)));
    const laneY = H - m.b + 22; // the "what you were doing" lane under the plot
    const span = Math.max(1, to - from);
    const maxMb = Math.max(100, ...series.flatMap((x) => x.points.map((p) => p.mb)));
    const step = maxMb > 4000 ? 1000 : maxMb > 1500 ? 500 : maxMb > 600 ? 200 : 100;
    const top = Math.ceil(maxMb / step) * step;
    const X = (t) => m.l + ((t - from) / span) * (W - m.l - m.r);
    const Y = (mb) => H - m.b - (mb / top) * (H - m.t - m.b);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "GPU memory over time with your actions and crashes" });

    for (let v = 0; v <= top; v += step) {
      svg.append(s("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v ? "gridline" : "baseline" }));
      svg.append(s("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", class: "tick" }, v >= 1000 ? `${v / 1000} GB` : `${v} MB`));
    }
    const ticks = W < 500 ? 3 : 6;
    for (let i = 0; i <= ticks; i++) {
      const t = from + (span * i) / ticks;
      svg.append(s("text", { x: X(t), y: H - 6, "text-anchor": i === 0 ? "start" : i === ticks ? "end" : "middle", class: "tick" }, fmtTime(t, span)));
    }
    svg.append(s("text", { x: m.l, y: laneY - 10, class: "tick" }, "What you were doing"));
    svg.append(s("line", { x1: m.l, x2: W - m.r, y1: laneY, y2: laneY, class: "gridline" }));

    // Memory lines (steps: memory stays the same until the next sample).
    for (const se of series) {
      const pts = se.points.filter((p) => p.t >= from - 3600000 && p.t <= to).sort((a, b) => a.t - b.t);
      if (!pts.length) continue;
      let d = "";
      pts.forEach((p, i) => {
        const x = Math.max(m.l, X(p.t));
        const y = Y(p.mb);
        d += i ? `H${x.toFixed(1)}V${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
      });
      const lastPt = pts[pts.length - 1];
      if (lastPt.mb > 0) d += `H${Math.min(W - m.r, X(Math.min(to, Date.now()))).toFixed(1)}`;
      svg.append(s("path", { d, class: "line", style: `stroke:${se.color}` }));
    }

    // Crashes: red vertical lines.
    for (const c of crashes) {
      const x = X(c.t);
      svg.append(s("line", { x1: x, x2: x, y1: m.t, y2: laneY + 6, style: "stroke:var(--critical);stroke-width:2;stroke-dasharray:4 3" }));
      svg.append(s("path", { d: `M${x},${m.t - 2} l6,10 h-12 z`, style: "fill:var(--critical)" }));
    }
    // Action markers in the lane.
    for (const e of events) svg.append(s("circle", { cx: X(e.t), cy: laneY, r: 4.5, class: "dot", style: `fill:${e.color}` }));

    // Hover: nearest crash or action by time, plus memory at that moment.
    const guide = s("line", { class: "hover-line", y1: m.t, y2: laneY, visibility: "hidden" });
    svg.append(guide);
    const hit = s("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H - 20, class: "hit" });
    hit.addEventListener("pointermove", (ev) => {
      const r = svg.getBoundingClientRect();
      const t = from + (((ev.clientX - r.left) * (W / r.width) - m.l) / (W - m.l - m.r)) * span;
      const near = [...crashes.map((c) => ({ ...c, crash: true })), ...events].sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
      const at = near && Math.abs(X(near.t) - X(t)) < 14 ? near.t : t;
      guide.setAttribute("x1", X(at));
      guide.setAttribute("x2", X(at));
      guide.setAttribute("visibility", "visible");
      const rows = series
        .map((se) => {
          const before = se.points.filter((p) => p.t <= at).pop();
          return before && before.mb ? [se.name, `${before.mb} MB`, se.color] : null;
        })
        .filter(Boolean);
      const title = new Date(at).toLocaleString();
      const head = near && at === near.t ? [[near.crash ? "⚠ " + near.text : near.text, ""]] : [];
      showTip(ev, tipContent(title, [...head, ...(rows.length ? rows : [["GPU memory", "none loaded"]])]));
    });
    hit.addEventListener("pointerleave", () => {
      hideTip();
      guide.setAttribute("visibility", "hidden");
    });
    svg.append(hit);
    holder.replaceChildren(svg);
  };
  new ResizeObserver(draw).observe(holder);
  draw();
}

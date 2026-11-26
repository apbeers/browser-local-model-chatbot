keywords: chart, graph, bars, stats, dashboard, history, plot, visualize
# Pattern: simple bar chart with SVG (no library)
```html
<svg id="chart" viewBox="0 0 600 200" style="width:100%;height:200px" preserveAspectRatio="none"></svg>
```
```js
function drawBars(values, labels) {
  const max = Math.max(1, ...values);
  const w = 600 / values.length;
  chart.innerHTML = values.map((v, i) => {
    const h = (v / max) * 160;
    return `<rect x="${i * w + 8}" y="${170 - h}" width="${w - 16}" height="${h}" rx="4" fill="var(--accent)"/>` +
      `<text x="${i * w + w / 2}" y="192" text-anchor="middle" font-size="12" fill="var(--ink-2)">${labels[i]}</text>`;
  }).join("");
}
```

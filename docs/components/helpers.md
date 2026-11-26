# js/ui helper modules
- state.js: `state` (view, chat, live, els), `$(name)` = `state.els[name]`, `lsGet(key, default)`, `lsSet(key, value)` (localStorage).
- markdown.js: `renderMarkdown(text)` -> safe HTML string; `installCopyHandler(element)` makes code "Copy" buttons work.
- charts.js: `hBarChart(container, rows)`, `groupedHBarChart(container, rows, groups)`, `xyChart(container, series, opts)`,
  `colorVar(i)` -> `var(--s1)`... chart colors, `disposeCharts()`.
- diff.js: `diffLines(a, b)`, `diffView(a, b)`.
- install-help.js: `installHelp()` -> element explaining how to install on this device, or null.

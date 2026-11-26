# js/ui/views/*.js — pages
Each page module exports `async function render(root)` and draws into `root` (a `<section>`).
- models.js: downloaded models, storage, auto-delete, Download/Load/Delete buttons. Also exports `autoDeleteSelect()`.
- dashboard.js: filters + number tiles, then `renderCharts` (dashboard-charts.js) and `renderTables` (dashboard-tables.js).
- benchmark.js: runs `app.benchmark.runBenchmark` and shows a results table.
- settings.js: theme list and light/dark switch, device name, install help, auto-delete, delete data.
- theme-maker.js: `openThemeMaker(theme | null, onDone)` dialog.
- studio.js: Studio home (new app, templates, your apps, chatbot UIs). The workspace is in js/ui/studio/:
  workspace.js (layout and tabs), agent-panel.js, preview-tab.js, files-tab.js, changes-tab.js,
  console-tab.js, adapters.js (app vs chatbot UI), pin.js, personalize.js.
  studio-model.js: `prepareBuilder()` loads the coding model.
- run.js: runs a Studio app full screen (#/run/<id>). storage.js: the storage manager.
Pages use `h()` and classes `.page`, `.card`, `.row`, `.btn`, `.table-wrap` + `.table`, `.kpis` + `.kpi`.

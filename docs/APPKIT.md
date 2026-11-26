# appkit: what every Studio app can use

An app is ONE HTML file. It runs sandboxed and offline. `window.appkit` is always there.
All appkit functions are async: use `await`.

## Storage (saved on this device, only for this app)
```js
const items = await appkit.storage.get("items", []);   // second argument = default
await appkit.storage.set("items", items);              // any JSON value
await appkit.storage.remove("items");
const keys = await appkit.storage.keys();
await appkit.files.write("export.csv", text);           // text files
const text = await appkit.files.read("export.csv");
const names = await appkit.files.list();
```
Do NOT use localStorage, sessionStorage or indexedDB: they are blocked in apps.

## On-device AI
```js
const reply = await appkit.ai.ask("Write a haiku about rain");
const reply2 = await appkit.ai.chat(
  [{ role: "system", content: "You are brief." }, { role: "user", content: question }],
  { onToken: (soFar) => (out.textContent = soFar), maxTokens: 400 }
);
const data = JSON.parse(await appkit.ai.ask("Return JSON {\"name\": string}", { json: true }));
const { loaded, model, busy } = await appkit.ai.status();
```
Wrap AI calls in try/catch and show `err.message`; the model may be busy or not loaded.

## Tools
`await appkit.tools.list()` lists allowed tools; `await appkit.tools.call("wikipedia", { query: "Paris" })`.

## Other
- `appkit.notify("Saved!")` shows a message in the host app.
- `appkit.download("data.json", text, "application/json")` saves a file to the user's device.
- `appkit.theme.onChange(fn)` runs when light/dark or colors change (CSS variables update by themselves).

## Built-in styles (no setup needed)
Colors (switch for light/dark automatically): `var(--page)` background, `var(--surface)` cards,
`var(--surface-3)` hover, `var(--ink)` text, `var(--ink-2)` secondary text, `var(--muted)`,
`var(--border)`, `var(--accent)` buttons/links, `var(--accent-ink)` text on accent.

Classes:
- Layout: `ak-app` (page container, responsive), `ak-header` (title row), `ak-stack` (vertical gap),
  `ak-row` (horizontal, wraps), `ak-grid` (responsive cards), `ak-split` (sidebar + main on desktop,
  stacked on phones), `ak-spacer`, `ak-scroll` (side-scroll for wide tables).
- Parts: `ak-card`, `ak-btn` (+ `primary`, `danger`, `ghost`), `ak-input`, `ak-select`, `ak-textarea`,
  `ak-label` (wraps a label and its input), `ak-list` (rows in `<li>`), `ak-table`, `ak-badge`,
  `ak-stat` (`<b>` big number + `<span>` label), `ak-muted`, `ak-empty`.

## Skeleton
```html
<!doctype html>
<html lang="en">
<head><title>App name</title><style>/* your CSS */</style></head>
<body>
<main class="ak-app ak-stack">
  <header class="ak-header"><h1>App name</h1></header>
  <section class="ak-card">…</section>
</main>
<script>
  // your code; load saved data first, then render
</script>
</body>
</html>
```

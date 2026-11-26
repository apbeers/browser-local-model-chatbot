# Rules for writing code in this app

You are editing ONE file of a browser app. Follow these rules exactly.

1. Output the COMPLETE file in one code block. Never write "..." or "rest unchanged".
2. Keep every `export` that the file already has, with the same name and arguments.
   Other files import them.
3. Keep every `import` line you still use. Import paths are relative and end in `.js`.
4. Use plain modern JavaScript (ES modules). No TypeScript, no JSX, no npm packages,
   no `require()`. Use `document`, `fetch`, `async/await`.
5. Build elements with `h(tag, attrs, ...children)` from `dom.js`:
   `h("button", { class: "btn", type: "button", onclick: () => {} }, "Label")`.
   `attrs.html` sets innerHTML. Never put user text in `html`.
6. Read and save data only through the `app` object from `core/api.js`.
7. Colors: use CSS variables like `var(--accent)` and `var(--ink)`, never fixed colors,
   so light mode, dark mode and themes keep working.
8. Do not remove features the request didn't mention.
9. Keep the code short and simple. Prefer changing a few lines.

Example of a good small change, adding a date under a message:
```js
// before
h("div", { class: "bubble" }, m.content)
// after
h("div", { class: "bubble" }, m.content),
h("small", { class: "muted" }, new Date(m.at).toLocaleTimeString())
```

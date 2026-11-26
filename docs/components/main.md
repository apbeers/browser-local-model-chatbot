# js/ui/main.js — entry point
Loaded by index.html. Builds the page, then starts the app.

Order (keep it): `buildLayout(root)` -> `app.ready()` -> `registerSW()` -> `await app.init()`
-> `initSidebar()`, `initModelPicker()`, `initChatView()` -> `route()` on every `hashchange`.

`route()` reads `location.hash` (`#/chat/<id>`, `#/models`, ...), shows one view from
`state.els.views`, and lazy-loads the page module from `VIEWS` (each exports `render(rootElement)`).
To add a page: add it to `NAV` in layout.js, to `VIEWS` and `TITLES` here, and create
`js/ui/views/<name>.js` with `export async function render(root) { ... }`.

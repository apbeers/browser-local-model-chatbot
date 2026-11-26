# Architecture

Local LLM Bench is a chat app that runs language models on the user's device with WebGPU.
It is plain JavaScript ES modules and CSS. There is no build step and no framework.

## Layers

```
 +--------------------------------------------------------------+
 | index.html  (LOCKED boot shell: theme pre-paint, watchdog)    |
 |   loads css/app.css, css/custom.css, js/ui/main.js            |
 +------------------------------+-------------------------------+
                                |
 +------------------------------v-------------------------------+
 | UI LAYER  js/ui/**  css/**      (CUSTOMIZABLE in Studio)       |
 |                                                               |
 |  main.js ----> layout.js   (builds the page into #root)       |
 |     |    ----> sidebar.js  (new chat, search, projects, chats) |
 |     |    ----> chat/chat-view.js  (messages, sending)          |
 |     |            |-> chat/message.js      (one message)        |
 |     |            |-> chat/model-picker.js (model dropdown)     |
 |     |            |-> chat/stats-strip.js  (live speed numbers) |
 |     |            |-> chat/empty-state.js  (new chat screen)    |
 |     |            '-> chat/chat-actions.js (rename/move/delete) |
 |     '----> views/*.js  (models, dashboard, benchmark,         |
 |                         studio, settings, theme-maker)         |
 |  helpers: dom.js (h(), dialogs, toast, formatting),            |
 |           markdown.js, charts.js, diff.js, state.js            |
 +------------------------------+-------------------------------+
                                |  only through the `app` object
 +------------------------------v-------------------------------+
 | CORE  js/core/**   (LOCKED: custom UIs can't change it)        |
 |  api.js (the `app` object) -> engine.js (WebLLM in a worker)   |
 |  chats.js  projects.js  stats.js  models.js  themes.js         |
 |  variants.js (custom UIs)  builder.js (coding model)           |
 |  benchmark.js  retention.js (settings, auto-delete)  opfs.js   |
 +------------------------------+-------------------------------+
                                |
 +------------------------------v-------------------------------+
 | vendor/web-llm (WebLLM engine)   sw.js (offline + custom UIs)  |
 | Storage: OPFS (chats, stats, models, settings, custom UIs)     |
 +--------------------------------------------------------------+
```

## Rules that keep custom UIs working
1. UI files import the core ONLY as `import { app } from "../core/api.js";`
   (from `js/ui/views/` or `js/ui/chat/` it is `"../../core/api.js"`).
2. Never import from `js/core/` files other than `api.js`.
3. `js/ui/main.js` must call `app.ready()` after it builds the page, or the
   startup watchdog shows an error after 12 seconds.
4. All data (chats, projects, stats, settings) is read and written through `app`.

## How a custom UI is served
A custom UI is a set of replacement files stored on the device. When the app
requests `js/ui/...` or `css/...`, the service worker (sw.js) returns the custom
UI's version if it has one, otherwise the default file. So a custom UI only
needs to contain the files it changes.

## Data flow for one chat message
1. chat-view.js `send(text)` saves the user message with `app.chats.saveChat`.
2. It calls `app.llm.generate(messages, { onToken })`; `onToken(fullText)` runs
   as text streams in and the UI re-renders the reply.
3. The engine records speed stats; `app.llm` fires a "generation" event.
4. The reply is saved with `app.chats.saveChat` and `app.emit("chats-changed")`
   tells the sidebar to refresh.

## Routes (location.hash)
`#/chat`, `#/chat/<chatId>`, `#/models`, `#/dashboard`, `#/benchmark`,
`#/studio`, `#/settings`. main.js `route()` shows one `<section class="view">`.

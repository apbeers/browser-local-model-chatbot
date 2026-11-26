# The `app` object (js/core/api.js)

UI code talks to the app only through `app`:
```js
import { app } from "../core/api.js";        // from js/ui/*.js
import { app } from "../../core/api.js";     // from js/ui/chat/*.js or js/ui/views/*.js
```
API version: `app.apiVersion` (1). It is also available as `window.app`.

## Startup
- `await app.init()` loads the model list, checks the GPU, runs auto-delete. Call once.
- `app.ready()` tells the startup watchdog the UI works. Call right after building the page.

## Events
- `app.on(name, fn)` subscribes and returns an unsubscribe function. `app.emit(name, detail)` fires.
- Names: `"chats-changed"`, `"projects-changed"`, `"models-changed"`, `"load-progress"` ({progress 0..1, text}),
  `"load-failed"`, `"auto-deleted"` ({models, chats}).

## Models and the engine: `app.llm`
- `app.llm.state`: `"idle" | "loading" | "ready" | "generating" | "error"`.
- `app.llm.modelId`, `app.llm.model` ({id, label, bytes, vramMB, contextWindow}), `app.llm.contextWindow`.
- `await app.loadModel(id)` downloads if needed (asks first for big models), loads, shows errors. Returns true/false.
- `await app.llm.generate(messages, { onToken })` -> `{ text, gen }`.
  `messages` = `[{ role: "system" | "user" | "assistant", content }]`.
  `onToken(fullTextSoFar)` runs while streaming. `gen` has stats: `decodeTps`, `prefillTps`, `ttftMs`,
  `promptTokens`, `completionTokens`, `contextTokens`, `contextWindow`.
- `app.llm.interrupt()` stops the reply. `app.llm.addEventListener("state" | "progress" | "generation", fn)`.
- `app.catalog.quick` = recommended models, `app.catalog.all` = every model.
  Each: `{ id, label, bytes, vramMB, contextWindow, group: "small"|"medium"|"large"|"more" }`.
- `app.isSaved(model)` true when downloaded. `app.modelUsable(model)` false if the GPU can't run it.
- `app.models.fmtBytes(n)` -> "203 MB".

## Chats: `app.chats`
A chat: `{ id, title, projectId, modelId, createdAt, updatedAt, messages: [{ role, content, at, modelLabel?, stats?, error? }] }`.
- `await app.chats.listChats()` -> index entries `{ id, title, updatedAt, projectId, count }`, newest first.
  `listChats({ projectId })` filters (use `null` for chats without a project).
- `await app.chats.getChat(id)`, `app.chats.newChat({ projectId })`, `await app.chats.saveChat(chat)`.
- `renameChat(id, title)`, `moveChat(id, projectId)`, `deleteChat(id)`, `deleteAllChats()`.
- `await app.chats.searchChats(text)` -> `[{ chat, hits: [{ index, role, snippet }] }]`.
- `await app.chats.exportChats(ids, "md" | "json")` -> string.
- After changing chats call `app.emit("chats-changed")`.

## Projects: `app.projects`
A project: `{ id, name, instructions, defaultModel, autoDeleteDays }`.
- `listProjects()`, `getProject(id)`, `createProject({ name, instructions })`, `updateProject(id, patch)`,
  `deleteProject(id, { deleteChatsToo })`. After changes: `app.emit("projects-changed")`.

## Settings: `app.settings`
- `await app.settings.get()` -> `{ autoDeleteDays, chatAutoDeleteDays, showAllModels, themeId }`.
- `await app.settings.set(key, value)`.

## Themes: `app.themes`
- `setMode("system" | "light" | "dark")`, `getMode()`.
- `listThemes()`, `activateTheme(id)` ("default" = built in), `saveTheme(theme)`, `deleteTheme(id)`.
- `checkTheme(theme)` -> `{ ok, errors, warnings }`. See THEMING.md.

## Stats: `app.stats`
- `await app.stats.loadAllSessions()` -> sessions `{ id, deviceLabel, model, load, generations: [gen...] }`.
- `median(numbers)`, `percentile(numbers, 90)`.

## Other
- `app.device.getDeviceInfo()`, `app.device.gpuLabel(app.gpu)`, `app.gpu.available`, `app.gpu.shaderF16`.
- `app.install.isStandalone()`, `app.install.canPrompt()`, `app.install.promptInstall()`.
- `app.benchmark.runBenchmark(app.llm, { reps, onStep })`.
- `app.route()` re-renders the current page.

## UI helpers (not part of `app`; import from js/ui/dom.js)
`h(tag, attrs, ...children)`, `iconBtn(iconName, label, onclick)`, `toast(text)`,
`await confirmDialog(title, body, okLabel)`, `await promptDialog(title, value)`, `modal(title, element)`,
`fmtNum(n, digits)`, `fmtMs(ms)`, `fmtDate(t)`, `relTime(t)`, `downloadFile(name, text, type)`.
EOF

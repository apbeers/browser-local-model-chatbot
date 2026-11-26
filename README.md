# Local LLM Bench

**Open the app: https://apbeers.github.io/browser-local-model-chatbot/**

A chat app that runs language models **on your device** with WebGPU, measures how fast they run, and lets you **build your own version of the app** with an on-device coding model. Nothing is sent to a server.

- **Engine:** [WebLLM](https://github.com/mlc-ai/web-llm) 0.2.89 (Apache-2.0), vendored in `vendor/web-llm/`. It is the only third-party code; the UI, Markdown, charts, storage and stats are hand-written.
- **Models:** downloaded from the [mlc-ai builds on Hugging Face](https://huggingface.co/mlc-ai) the first time they're used and saved in the browser. Nothing is hosted in this repo.
- **Storage:** everything stays on the device in the Origin Private File System (OPFS): models, chats, projects, stats, settings, themes and custom UIs.
- **Offline:** an installable PWA (Add to Home Screen on iPhone/iPad/Android, Install on desktop). After the first visit the app and any downloaded model work with no connection.

## Features

- **Chat** with Markdown replies, regenerate, copy, and live speed numbers (decode and prefill tok/s, time to first token, context used / window, session totals, load time, GPU). Both the stats strip and the per-reply stats can be hidden (Settings → Display). Layouts for phones, desktops and ultrawide screens (stats move to a side panel at 1800px+).
- **Tools and web access** (per chat, per project, or default in Settings: off / offline / web). Any model can call tools: each step it picks one tool and one text input with JSON-constrained output, up to 3 calls, then answers with the results. Offline: calculator, date/time, run JavaScript (sandboxed Worker, 3 s limit), search chats, notes. Web (only sources that allow browser access): Wikipedia, Open-Meteo weather, Hacker News, any URL that allows CORS. Tool calls are shown with each reply.
- **Projects:** groups of chats with instructions (system prompt), a default model, tools and their own auto-delete. Search across chats; export a chat or project as Markdown or JSON.
- **Models:** 27 common models grouped by size (✓ on downloaded ones), optionally every WebLLM model. Auto-delete unused models after 30/60/90 days (off by default).
- **Studio, an offline code editor with an on-device agent:**
  - Desktop: agent chat on the left; **Preview** (phone/tablet/desktop/ultrawide sizes), **Files**, **Changes** (diffs, history, undo) and **Console** tabs. Phones: one panel at a time with a bottom tab bar.
  - **Apps** are single-file HTML tools (like artifacts) that run sandboxed. `appkit` gives each one its own storage and files, the on-device model, tools and the theme (light/dark follow the app). 7 starter templates.
  - The agent plans (JSON), writes from the closest template, checks syntax and runs the draft in the preview to catch errors, and fixes them (up to twice). You keep or discard the draft.
  - Coding model: Qwen2.5-Coder 1.5B on phones, 3B on laptops, 7B on desktops with a discrete GPU, with every size selectable; 8k context on phones, 16k on desktops.
  - **Pin apps to the Home Screen** as their own installable apps that work offline. Each pin carries a packed copy of the app so a fresh iPhone/iPad Home Screen app can set itself up.
  - **Custom chatbot UIs** use the same workspace (drafts previewed before saving).
  - **Customize for me:** turns your usage log into a plan (start page, menu order, hidden pages, example prompts, accent, compact layout) and builds a custom UI from it.
- **Themes:** built-in light/dark plus your own (designed by the coding model or by hand); every theme has light and dark colors and follows the system by default.
- **Storage manager:** every file the app keeps in OPFS, Cache Storage and localStorage, with what it is and where it came from; view and delete. Website files are listed read-only.
- **Usage log** (on by default, device only, never message text): pages and features used, plus optional 1–3 word chat topics labelled on the device. View, turn off or delete in Settings.
- **Stats dashboard** and **Benchmark** as before: filter by model, device, project, type and time; export/import JSON to compare devices.

## How custom UIs work

```
index.html (locked boot shell + startup watchdog)
   └─ js/ui/**, css/**   UI layer      ← customizable; a custom UI stores replacement files in OPFS
        └─ app object (js/core/api.js) ← the only way UI code reaches the core
             └─ js/core/**  core        ← locked: storage, engine, stats, themes, custom UIs, builder
                  └─ vendor/web-llm, sw.js
```

- A custom UI is a set of replacement files for `css/*.css` and `js/ui/*.js`, stored in OPFS and mirrored to Cache Storage. The service worker serves the custom file when one exists and the default otherwise.
- The core (`js/core/`), `index.html`, `recover.html`, `sw.js` and WebLLM can't be overridden, so chats and stats stay safe and compatible.
- **Safety net:** add `?safe` to the address for the default UI; `recover.html` lists, switches and deletes custom UIs without running any app code; if a custom UI fails to start within 12 seconds the app offers the default and switches back automatically on the next launch.
- Custom UIs record the API version they were built for, and Studio flags them when the app's API changes.
- UIs and themes can't be imported from elsewhere. Custom code runs with the same access as the app, so only code made on the device is used.

### The coding model

Studio and the theme maker use **Qwen2.5-Coder 1.5B** (about 880 MB, f32 version on GPUs without f16). WebLLM builds it with a 4k context, so the builder loads it with **16k tokens on desktops and 8k on phones**. Because it's a small model, every request gets only:

1. `docs/STUDIO_RULES.md`: explicit rules (output the whole file, keep exports, use `h()` and CSS variables).
2. The docs for that one file (`docs/files.json` maps each file to its doc and summary), plus `docs/API.md` and `docs/ARCHITECTURE.md` (or `THEMING.md` and `CSS_CLASSES.md` for styles).
3. The current file and the request.

Themes use JSON-schema-constrained output, so the model can only answer with valid color values.

## Docs shipped to the browser

`docs/` is part of the app and is cached for offline use:
`ARCHITECTURE.md` (diagram and data flow), `API.md` (the `app` object), `THEMING.md` (color tokens), `CSS_CLASSES.md`, `STUDIO_RULES.md`, `components/*.md` (one per UI file), `files.json`, and for Studio apps `APPKIT.md`, `APP_RULES.md`, `patterns/*.md` (small code patterns picked by keyword) and `templates/*.html`.

## Development

No build step. Serve the folder and open it:

```sh
python3 -m http.server 8000
```

After changing any file, run `node tools/build_sw.mjs`. It regenerates `docs/files.json` and the service-worker file list and cache version, so installed copies update.

To change the quick-select models, edit `QUICK` in `tools/build_catalog.mjs` and run it (it reads exact download sizes from the Hugging Face API; `NODE_USE_ENV_PROXY=1` behind a proxy), then `node tools/build_sw.mjs`.

## Deploying

GitHub Pages serves `main` from the repo root.

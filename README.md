# Local LLM Bench

A browser chatbot for measuring how well small language models run **on-device** in different browsers, phones, tablets and computers. Models run on the GPU via WebGPU. Nothing is sent to a server.

- **Engine:** [WebLLM](https://github.com/mlc-ai/web-llm) 0.2.88 (Apache-2.0), vendored at `vendor/web-llm/`. It's the only third-party code; the UI, Markdown renderer, storage, stats and charts are all hand-written.
- **Models:** MLC builds from Hugging Face, re-hosted on GitHub Pages (see below).
- **Storage:** everything is kept in the browser's Origin Private File System (OPFS): downloaded models, chats and stats.
- **Offline:** an installable PWA. After the first visit, the app and any downloaded model work with no network.

## Features

- Multiple saved conversations (rename/delete), Markdown replies (code blocks with copy, lists, tables, quotes).
- Model picker with size, download state and GPU compatibility (`shader-f16`).
- **Models page:** see which models are saved in the browser and how much space they use; delete one or all; request persistent storage.
- **Live stats** in the chat: decode tok/s (live while streaming), prefill tok/s, time to first token, context used / context window, session totals, load time (cache vs download), GPU.
- **Stats dashboard:** every session is written to OPFS as it runs (`app/stats/sessions/<id>.json`). Filter by model, device and time range. KPIs, charts (speed by model × device, speed over time, throttling across a long reply, speed vs context, TTFT vs prompt size, load times), a group-by summary table (model, device, model × device, browser, OS, GPU, day), per-session details and deletion.
- **Compare devices:** name each device in Settings, export its stats as JSON, then import exports from other devices into one dashboard.
- Light / dark / system theme; works from phone width up.

## What's recorded per session

Device: browser and version, OS, device model (where exposed), CPU cores, `deviceMemory`, screen, GPU adapter info, features and limits, battery level/charging (where exposed).

Load: whether the model was already cached, total load time, time per phase (download / cache read / other), download size and MB/s, errors.

Per reply: prompt tokens processed, output tokens, context tokens in the KV cache, engine-reported prefill and decode tok/s, client-measured TTFT and wall-clock tok/s, end-to-end latency, tok/s in 16-token windows (for throttling), finish reason, battery, JS heap. Load failures, generation errors and GPU device loss are logged too. Browsers without WebGPU are logged once as a failed session.

## Models and hosting

GitHub Pages sites are limited to about 1 GB and git rejects files over 100 MB, so:

| Model | Download | Hosted in |
|---|---|---|
| SmolLM2 360M (q4f16_1) | 203 MB | this repo |
| SmolLM2 360M (q4f32_1, for GPUs without `shader-f16`) | 203 MB | this repo |
| Qwen2.5 0.5B Instruct (q4f16_1) | 277 MB | this repo |
| Qwen2.5 1.5B Instruct (q4f16_1) | 841 MB | [apbeers/browser-models-large](https://github.com/apbeers/browser-models-large) |

Files are laid out like Hugging Face (`models/<id>/resolve/main/…`, libraries in `models/libs/`). Any file at or above 95 MB is split into `name.partN` pieces; the engine worker (`js/llm-worker.js`) joins them back into one stream when WebLLM asks for the original file.

### Adding a model

1. Pick a model WebLLM ships a prebuilt library for (`prebuiltAppConfig` in `vendor/web-llm/index.js`).
2. Download and split it: `python3 tools/fetch_model.py <repo-dir> <model-id> <lib-file.wasm>`
3. Add a label to `INFO` in `tools/build_catalog.mjs`, then run `node tools/build_catalog.mjs ../browser-models-large`.
4. Run `node tools/build_sw.mjs` so installed PWAs pick up the change.

Keep each Pages repo under ~1 GB; use another repo (and add it to `HOSTS`) for more.

## Development

No build step. Serve the folder over http(s) and open it:

```sh
python3 -m http.server 8000
```

After changing any app file, run `node tools/build_sw.mjs` to bump the service-worker cache version.

## Deploying

Enable GitHub Pages for this repo (Settings → Pages → Deploy from a branch → root) and do the same for `browser-models-large`. The app expects the large repo at `https://apbeers.github.io/browser-models-large/`.

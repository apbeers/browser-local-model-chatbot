# Local LLM Bench

**Open the app: https://apbeers.github.io/browser-local-model-chatbot/**

A browser chatbot for measuring how well small language models run **on-device** in different browsers, phones, tablets and computers. Models run on the GPU via WebGPU. Nothing is sent to a server.

- **Engine:** [WebLLM](https://github.com/mlc-ai/web-llm) 0.2.88 (Apache-2.0), vendored at `vendor/web-llm/`. It's the only third-party code; the UI, Markdown renderer, storage, stats and charts are all hand-written.
- **Models:** downloaded straight from the [mlc-ai builds on Hugging Face](https://huggingface.co/mlc-ai) the first time they're used. Nothing is hosted in this repo.
- **Storage:** everything is kept in the browser's Origin Private File System (OPFS): downloaded models, chats and stats.
- **Offline:** an installable PWA (Add to Home Screen on iPhone/iPad/Android, Install on desktop). After the first visit the app opens with no network, and any downloaded model loads with no network.

## Features

- Multiple saved conversations (rename/delete), Markdown replies (code blocks with copy, lists, tables, quotes).
- Model picker with 24 common models grouped by download size (small / medium / large), a ✓ on models already saved, and GPU compatibility (`shader-f16`). Settings can add every other WebLLM model (about 110 more).
- **Models page:** see which models are saved in the browser and how much space they use; delete one or all; request persistent storage.
- **Auto-delete:** optionally remove downloaded models that haven't been used for 30, 60 or 90 days (default: never). Checked when the app opens and every few hours; the loaded model is never deleted.
- **Live stats** in the chat: decode tok/s (live while streaming), prefill tok/s, time to first token, context used / context window, session totals, load time (cache vs download), GPU.
- **Stats dashboard:** every session is written to OPFS as it runs (`app/stats/sessions/<id>.json`). Filter by model, device and time range. KPIs, charts (speed by model × device, speed over time, throttling across a long reply, speed vs context, TTFT vs prompt size, load times), a group-by summary table (model, device, model × device, browser, OS, GPU, day), per-session details and deletion.
- **Compare devices:** name each device in Settings, export its stats as JSON, then import exports from other devices into one dashboard.
- Light / dark / system theme; works from phone width up.

## What's recorded per session

Device: browser and version, OS, device model (where exposed), CPU cores, `deviceMemory`, screen, GPU adapter info, features and limits, battery level/charging (where exposed).

Load: whether the model was already cached, total load time, time per phase (download / cache read / other), download size and MB/s, errors.

Per reply: prompt tokens processed, output tokens, context tokens in the KV cache, engine-reported prefill and decode tok/s, client-measured TTFT and wall-clock tok/s, end-to-end latency, tok/s in 16-token windows (for throttling), finish reason, battery, JS heap. Load failures, generation errors and GPU device loss are logged too. Browsers without WebGPU are logged once as a failed session.

## Models

The quick-select list lives in `tools/build_catalog.mjs`. To change it, edit `QUICK` and regenerate `models.json`, which records exact download sizes from the Hugging Face API:

```sh
NODE_USE_ENV_PROXY=1 node tools/build_catalog.mjs   # NODE_USE_ENV_PROXY only needed behind a proxy
node tools/build_sw.mjs
```

Any model in WebLLM's prebuilt list can be added. Weights come from `huggingface.co/mlc-ai/<model>`; the compiled model libraries come from the `mlc-ai/binary-mlc-llm-libs` GitHub repo.

## Development

No build step. Serve the folder over http(s) and open it:

```sh
python3 -m http.server 8000
```

After changing any app file, run `node tools/build_sw.mjs` to bump the service-worker cache version.

## Deploying

GitHub Pages serves `main` from the repo root. Run `node tools/build_sw.mjs` before pushing app changes so installed copies update.

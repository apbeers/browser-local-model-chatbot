#!/usr/bin/env node
// Regenerates models/catalog.json from the meta.json files written by
// tools/fetch_model.py in this repo and in the large-models repo.
//
//   node tools/build_catalog.mjs [path/to/browser-models-large]
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prebuiltAppConfig } from "../vendor/web-llm/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const largeRepo = path.resolve(process.argv[2] || path.join(repo, "..", "browser-models-large"));
const pkg = fs.readFileSync(path.join(repo, "vendor/web-llm/VERSION"), "utf8").trim();

const HOSTS = {
  main: { base: "./", repo: "apbeers/browser-local-model-chatbot", dir: path.join(repo, "models") },
  large: {
    base: "https://apbeers.github.io/browser-models-large/models/",
    repo: "apbeers/browser-models-large",
    dir: path.join(largeRepo, "models"),
  },
};

// Human-facing info that is not in the model files.
const INFO = {
  "SmolLM2-360M-Instruct-q4f16_1-MLC": { label: "SmolLM2 360M", family: "SmolLM2", params: 0.36, license: "Apache-2.0" },
  "SmolLM2-360M-Instruct-q4f32_1-MLC": {
    label: "SmolLM2 360M (f32, no shader-f16)",
    family: "SmolLM2",
    params: 0.36,
    license: "Apache-2.0",
  },
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC": { label: "Qwen2.5 0.5B", family: "Qwen2.5", params: 0.49, license: "Apache-2.0" },
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC": { label: "Qwen2.5 1.5B", family: "Qwen2.5", params: 1.54, license: "Apache-2.0" },
};

const models = [];
for (const [host, h] of Object.entries(HOSTS)) {
  if (!fs.existsSync(h.dir)) {
    console.warn(`skip host ${host}: ${h.dir} not found`);
    continue;
  }
  for (const id of fs.readdirSync(h.dir).sort()) {
    const metaPath = path.join(h.dir, id, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const pre = prebuiltAppConfig.model_list.find((m) => m.model_id === id);
    if (!pre) throw new Error(`${id} is not in WebLLM's prebuilt list; add a model record by hand`);
    const quant = id.match(/(q\d+f\d+(?:_\d+)?)/)?.[1] || "";
    const info = INFO[id] || { label: id, family: "", params: null };
    // Bytes WebLLM actually downloads into its cache: weight shards, the
    // tensor manifest, chat config, tokenizer.json and the model library.
    const dir = path.join(h.dir, id, "resolve", "main");
    let downloadBytes = fs.statSync(path.join(h.dir, "libs", meta.lib)).size;
    for (const f of fs.readdirSync(dir)) {
      if (/^params_shard_\d+\.bin(\.part\d+)?$/.test(f) || ["tensor-cache.json", "mlc-chat-config.json", "tokenizer.json"].includes(f)) {
        downloadBytes += fs.statSync(path.join(dir, f)).size;
      }
    }
    models.push({
      id,
      host,
      ...info,
      quant,
      requiresF16: /f16/.test(quant),
      lib: meta.lib,
      bytes: downloadBytes,
      repoBytes: meta.bytes,
      vramMB: Math.round(pre.vram_required_MB || 0),
      contextWindow: pre.overrides?.context_window_size || null,
      lowResource: !!pre.low_resource_required,
      source: meta.source,
      revision: meta.revision,
      splits: meta.splits,
    });
  }
}
models.sort((a, b) => a.bytes - b.bytes);

const hosts = {};
for (const [k, h] of Object.entries(HOSTS)) hosts[k] = { base: k === "main" ? "./" : h.base, repo: h.repo };

const catalog = { generatedAt: new Date().toISOString(), webllm: pkg, hosts, models };
fs.writeFileSync(path.join(repo, "models/catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
console.log(`wrote ${models.length} models`);
for (const m of models) console.log(`  ${m.host.padEnd(6)} ${(m.bytes / 1e6).toFixed(0).padStart(5)} MB  ${m.id}`);

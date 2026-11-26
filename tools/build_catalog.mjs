#!/usr/bin/env node
// Regenerates models.json: the quick-select model list (with exact download
// sizes from the Hugging Face API) plus every other WebLLM prebuilt chat model.
// Models are downloaded by the browser straight from Hugging Face; nothing is
// hosted in this repo.
//
//   node tools/build_catalog.mjs
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prebuiltAppConfig } from "../vendor/web-llm/index.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webllmVersion = fs.readFileSync(path.join(repo, "vendor/web-llm/VERSION"), "utf8").trim();

// Quick-select list, in display order within each size group.
// sampling: overrides for models whose shipped config samples too loosely.
const SMOL = { temperature: 0.2, top_p: 0.9 };
const QUICK = [
  ["SmolLM2-135M-Instruct-q0f16-MLC", "SmolLM2 135M", "SmolLM2", 0.135, { sampling: SMOL }],
  ["SmolLM2-360M-Instruct-q4f16_1-MLC", "SmolLM2 360M", "SmolLM2", 0.36, { sampling: SMOL }],
  ["SmolLM2-360M-Instruct-q4f32_1-MLC", "SmolLM2 360M (f32)", "SmolLM2", 0.36, { sampling: SMOL }],
  ["Qwen2.5-0.5B-Instruct-q4f16_1-MLC", "Qwen2.5 0.5B", "Qwen2.5", 0.49],
  ["Qwen3-0.6B-q4f16_1-MLC", "Qwen3 0.6B", "Qwen3", 0.6, { reasoning: true }],
  ["Qwen3.5-0.8B-q4f16_1-MLC", "Qwen3.5 0.8B", "Qwen3.5", 0.8, { reasoning: true }],
  ["gemma3-1b-it-q4f16_1-MLC", "Gemma 3 1B", "Gemma", 1.0],
  ["Llama-3.2-1B-Instruct-q4f16_1-MLC", "Llama 3.2 1B", "Llama", 1.24],
  ["Llama-3.2-1B-Instruct-q4f32_1-MLC", "Llama 3.2 1B (f32)", "Llama", 1.24],
  ["Qwen2.5-1.5B-Instruct-q4f16_1-MLC", "Qwen2.5 1.5B", "Qwen2.5", 1.54],
  ["Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC", "Qwen2.5 Coder 1.5B", "Qwen2.5", 1.54],
  ["Qwen3-1.7B-q4f16_1-MLC", "Qwen3 1.7B", "Qwen3", 1.7, { reasoning: true }],
  ["SmolLM2-1.7B-Instruct-q4f16_1-MLC", "SmolLM2 1.7B", "SmolLM2", 1.7, { sampling: SMOL }],
  ["Qwen3.5-2B-q4f16_1-MLC", "Qwen3.5 2B", "Qwen3.5", 2.0, { reasoning: true }],
  ["gemma-2-2b-it-q4f16_1-MLC", "Gemma 2 2B", "Gemma", 2.6],
  ["Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC", "Qwen2.5 Coder 0.5B", "Qwen2.5", 0.49],
  ["Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC", "Qwen2.5 Coder 3B", "Qwen2.5", 3.1],
  ["Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC", "Qwen2.5 Coder 7B", "Qwen2.5", 7.6],
  ["Llama-3.2-3B-Instruct-q4f16_1-MLC", "Llama 3.2 3B", "Llama", 3.2],
  ["Qwen2.5-3B-Instruct-q4f16_1-MLC", "Qwen2.5 3B", "Qwen2.5", 3.1],
  ["gemma-4-E2B-it-q4f16_1-MLC", "Gemma 4 E2B", "Gemma", 5.1],
  ["Phi-4-mini-instruct-q4f16_1-MLC", "Phi-4 mini", "Phi", 3.8],
  ["Qwen3-4B-q4f16_1-MLC", "Qwen3 4B", "Qwen3", 4.0, { reasoning: true }],
  ["Mistral-7B-Instruct-v0.3-q4f16_1-MLC", "Mistral 7B v0.3", "Mistral", 7.2],
  ["DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC", "DeepSeek R1 Distill 7B", "DeepSeek", 7.6, { reasoning: true }],
  ["Llama-3.1-8B-Instruct-q4f16_1-MLC", "Llama 3.1 8B", "Llama", 8.0],
  ["Qwen3-8B-q4f16_1-MLC", "Qwen3 8B", "Qwen3", 8.2, { reasoning: true }],
];

const quantOf = (id) => id.match(/(q\d+f\d+(?:_\d+)?)/)?.[1] || "";
const hfRepo = (url) => new URL(url).pathname.replace(/^\/|\/$/g, "").replace(/\/resolve\/.*$/, "");

function base(pre) {
  const quant = quantOf(pre.model_id);
  const f16 = /f16/.test(quant) || (pre.required_features || []).includes("shader-f16");
  return {
    id: pre.model_id,
    hfRepo: hfRepo(pre.model),
    lib: pre.model_lib,
    quant,
    requiresF16: f16,
    vramMB: Math.round(pre.vram_required_MB || 0),
    contextWindow: pre.overrides?.context_window_size || null,
    lowResource: !!pre.low_resource_required,
  };
}

async function hfSize(repoId, lib) {
  const res = await fetch(`https://huggingface.co/api/models/${repoId}/tree/main`);
  if (!res.ok) throw new Error(`${repoId}: HTTP ${res.status}`);
  const files = await res.json();
  const has = (n) => files.some((f) => f.path === n);
  const tok = has("tokenizer.json") ? "tokenizer.json" : "tokenizer.model";
  let bytes = 0;
  for (const f of files) {
    if (/^params_shard_\d+\.bin$/.test(f.path) || ["tensor-cache.json", "mlc-chat-config.json", tok].includes(f.path)) bytes += f.size || 0;
  }
  const head = await fetch(lib, { method: "HEAD" });
  bytes += Number(head.headers.get("content-length") || 0);
  return bytes;
}

const chat = prebuiltAppConfig.model_list.filter((m) => !/embed|snowflake/i.test(m.model_id) && m.model_type !== 1);
const quick = [];
for (const [id, label, family, params, extra] of QUICK) {
  const pre = chat.find((m) => m.model_id === id);
  if (!pre) throw new Error(`${id} is not in WebLLM ${webllmVersion}'s prebuilt list`);
  const m = { ...base(pre), label, family, params, ...(extra || {}) };
  m.bytes = await hfSize(m.hfRepo, m.lib);
  quick.push(m);
  console.log(`${(m.bytes / 1e6).toFixed(0).padStart(6)} MB  ${id}`);
}
const quickIds = new Set(quick.map((m) => m.id));
const more = chat
  .filter((m) => !quickIds.has(m.model_id) && !/-1k$/.test(m.model_id))
  .map((m) => ({ ...base(m), label: m.model_id.replace(/-MLC$/, ""), bytes: null }))
  .sort((a, b) => a.vramMB - b.vramMB);

const out = { generatedAt: new Date().toISOString(), webllm: webllmVersion, quick, more };
fs.writeFileSync(path.join(repo, "models.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote models.json: ${quick.length} quick-select, ${more.length} more`);

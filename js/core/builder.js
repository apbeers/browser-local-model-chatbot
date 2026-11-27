// The on-device builder: asks a small coding model to write a theme, extra CSS
// or one UI file. Small models need tight, explicit context, so each request
// gets: the rules (docs/STUDIO_RULES.md), the docs relevant to the task, the
// current file, and the user's request. Nothing else.
import { findModel } from "./catalog.js";

// Coder models offered for Studio, smallest first. f32 versions are used on GPUs without shader-f16.
export const CODER_MODELS = [
  "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC",
  "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC",
];
export const BUILDER_MODEL = CODER_MODELS[1];
const DOCS = new URL("../../docs/", import.meta.url).href;

const isMobile = () => /Android|iPhone|iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
const f32 = (id, gpu) => (gpu && gpu.available && !gpu.shaderF16 ? id.replace("q4f16_1", "q4f32_1") : id);

// Context for the coding model. Phones get 4k: iOS Safari gives WebGPU little
// memory and a bigger KV cache can make the GPU drop the model mid-answer.
// Computers: 16k with 8 GB+ memory, otherwise 8k.
// A model that ran out of memory here (oomModels[id].ctx = the context it had)
// gets half that next time, down to 4k (what chat uses).
export const MIN_BUILDER_CTX = 4096;
function deviceContextWindow() {
  if (isMobile()) return 4096;
  const mem = navigator.deviceMemory || 8;
  return mem >= 8 ? 16384 : 8192;
}
export function builderContextWindow(modelId, oomModels = {}) {
  const ctx = deviceContextWindow();
  const o = modelId && oomModels[modelId];
  if (!o) return ctx;
  return Math.max(MIN_BUILDER_CTX, Math.min(ctx, (o.ctx || ctx) / 2));
}
// True when a model ran out of memory even at the smallest Studio context.
export function oomAtMinimum(modelId, oomModels = {}) {
  const o = oomModels[modelId];
  return !!o && (o.ctx || deviceContextWindow()) <= MIN_BUILDER_CTX;
}

// Load options for the coding model (WebLLM fixes the prefill chunk size per
// model build, so only the context size can be changed).
export function builderLoadOptions(modelId, oomModels) {
  return { contextWindow: builderContextWindow(modelId, oomModels) };
}

// Automatic choice: 1.5B on phones and tablets, 7B on desktops with a
// discrete NVIDIA/AMD GPU, 3B on other computers. Models that ran out of GPU
// memory on this device (oomModels setting) are skipped for the next smaller one.
export function autoBuilderModel(gpu, oomModels = {}) {
  let i;
  if (isMobile()) i = 1;
  else {
    const vendor = ((gpu && gpu.vendor) || "").toLowerCase();
    const discrete = /nvidia|amd/.test(vendor) && !/integrated/.test(((gpu && gpu.description) || "").toLowerCase());
    i = discrete ? 3 : 2;
  }
  while (i > 0 && oomAtMinimum(f32(CODER_MODELS[i], gpu), oomModels)) i--;
  return f32(CODER_MODELS[i], gpu);
}

// setting: the "coderModel" setting ("auto" or a model id).
export function pickBuilderModel(gpu, setting = "auto", oomModels = {}) {
  return setting && setting !== "auto" ? setting : autoBuilderModel(gpu, oomModels);
}

// Options for the Studio model menu: [{id, label, note}].
export function coderOptions(catalog, gpu, oomModels = {}) {
  const auto = autoBuilderModel(gpu, oomModels);
  return CODER_MODELS.map((base) => {
    const id = f32(base, gpu);
    const m = catalog && catalog.all.find((x) => x.id === id);
    const size = (m && m.bytes) || (m && m.vramMB * 1048576 * 0.6);
    const big = /7B/.test(id) ? 3 : /3B/.test(id) ? 2 : /1\.5B/.test(id) ? 1 : 0;
    const oom = oomModels[id];
    const k = (n) => Math.round(n / 1024) + "k";
    const note = oom
      ? oomAtMinimum(id, oomModels)
        ? `ran out of memory here ${oom.count > 1 ? oom.count + " times" : "before"}`
        : `ran out of memory at ${k(oom.ctx || deviceContextWindow())} context, now uses ${k(builderContextWindow(id, oomModels))}`
      : id === auto
        ? "recommended for this device"
        : big > (isMobile() ? 1 : 2)
          ? "slow here, may run out of memory"
          : big < 1
            ? "fastest, weakest"
            : "";
    return { id, label: (m && m.label) || id, bytes: size || null, vramMB: m ? m.vramMB : null, note, oom: oomAtMinimum(id, oomModels) };
  });
}

export const estimateTokens = (s) => Math.ceil((s || "").length / 3.3);

const docCache = new Map();
export async function loadDoc(name) {
  if (!docCache.has(name)) {
    docCache.set(
      name,
      fetch(DOCS + name)
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => ""),
    );
  }
  return docCache.get(name);
}

export async function fileIndex() {
  try {
    return JSON.parse(await loadDoc("files.json"));
  } catch {
    return { files: [] };
  }
}

// Make sure the builder model is loaded with a large enough context window.
export async function ensureBuilder(app) {
  const s = await app.settings.get();
  const id = pickBuilderModel(app.gpu, s.coderModel, s.oomModels);
  const ctx = builderContextWindow(id, s.oomModels);
  if (app.llm.modelId !== id || app.llm.contextWindow !== ctx) await app.llm.load(id, { contextWindow: ctx });
  return { id, ctx, model: findModel(app.catalog, id) };
}

// ---------- themes ----------
const HEX = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
export function themeSchema(keys) {
  const colors = { type: "object", properties: Object.fromEntries(keys.map((k) => [k, HEX])), required: keys };
  return { type: "object", properties: { name: { type: "string" }, light: colors, dark: colors }, required: ["name", "light", "dark"] };
}

export async function generateTheme(app, description, { keys, help, base, onToken } = {}) {
  await ensureBuilder(app);
  const rules = await loadDoc("THEMING.md");
  const list = keys.map((k) => `- "${k}": ${help[k]}`).join("\n");
  const system =
    `${rules}\n\nYou design color themes. Reply with JSON only.\n` +
    `The JSON has "name" (2-3 words), "light" and "dark". "light" and "dark" each have exactly these keys, ` +
    `and every value is a 6-digit hex color like "#1a2b3c":\n${list}\n\n` +
    `Text colors ("ink", "ink-2") must be easy to read on "page", "surface" and "user-bubble". ` +
    `In "light" the backgrounds are light and text is dark. In "dark" the backgrounds are dark and text is light.\n` +
    `Example of the default theme:\n${JSON.stringify({ name: "Default", light: base.light, dark: base.dark })}`;
  const schema = themeSchema(keys);
  const res = await app.llm.generate(
    [
      { role: "system", content: system },
      { role: "user", content: `Make a theme: ${description}` },
    ],
    { onToken, kind: "builder-theme", request: { temperature: 0.4, max_tokens: 900, response_format: { type: "json_object", schema: JSON.stringify(schema) } } },
  );
  return JSON.parse(res.text);
}

// ---------- code ----------
export function extractCode(text, lang) {
  const blocks = [...text.matchAll(/```([\w-]*)\s*\n([\s\S]*?)```/g)];
  const pick = blocks.filter((b) => !b[1] || b[1].startsWith(lang === "css" ? "css" : "j")).pop() || blocks.pop();
  if (pick) return pick[2].replace(/\s+$/, "") + "\n";
  // Unclosed block at the end (ran out of tokens).
  const open = text.match(/```[\w-]*\s*\n([\s\S]*)$/);
  return open ? open[1] : text.trim() + "\n";
}

// Checks syntax without running the code. JS is parsed as a module in a worker
// with every import pointed at a URL that can't load, so it never executes.
export async function validate(path, code) {
  if (path.endsWith(".css")) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(code);
      const opens = (code.match(/{/g) || []).length;
      const closes = (code.match(/}/g) || []).length;
      if (opens !== closes) return { ok: false, error: `Unbalanced braces: ${opens} "{" and ${closes} "}"` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }
  const neutered = 'import "blocked:never";\n' + code.replace(/(\bfrom\s*|\bimport\s*)(["'])[^"']+\2/g, '$1"blocked:never"');
  const src = `self.onmessage = async (e) => { try { await import(e.data); self.postMessage({ ok: true }); } catch (err) { self.postMessage({ ok: !(err instanceof SyntaxError), error: String(err && err.message || err), syntax: err instanceof SyntaxError }); } };`;
  const workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const codeUrl = URL.createObjectURL(new Blob([neutered], { type: "text/javascript" }));
  try {
    return await new Promise((resolve) => {
      const w = new Worker(workerUrl, { type: "module" });
      const t = setTimeout(() => {
        w.terminate();
        resolve({ ok: true });
      }, 4000);
      w.onmessage = (e) => {
        clearTimeout(t);
        w.terminate();
        resolve(e.data.ok ? { ok: true } : { ok: false, error: e.data.error.replace(/blob:[^\s)]+/g, path) });
      };
      w.postMessage(codeUrl);
    });
  } finally {
    URL.revokeObjectURL(workerUrl);
    URL.revokeObjectURL(codeUrl);
  }
}

// Builds the prompt for changing one file and runs it.
// mode: "style" (path is css/custom.css) or "component" (any overridable file).
export async function generateFile(app, { path, current, request, onToken }) {
  const { ctx } = await ensureBuilder(app);
  const isCss = path.endsWith(".css");
  const lang = isCss ? "css" : "js";
  const index = await fileIndex();
  const entry = index.files.find((f) => f.path === path) || {};
  const parts = [["Rules", await loadDoc("STUDIO_RULES.md")]];
  if (isCss) {
    parts.push(["Theme tokens", await loadDoc("THEMING.md")], ["CSS classes", await loadDoc("CSS_CLASSES.md")]);
  } else {
    if (entry.doc) parts.push(["About this file", await loadDoc(entry.doc)]);
    parts.push(["The app API", await loadDoc("API.md")], ["Architecture", await loadDoc("ARCHITECTURE.md")]);
  }
  const fileTokens = estimateTokens(current);
  const reserve = Math.round(fileTokens * 1.3) + 600; // room for the answer
  let budget = ctx - reserve - fileTokens - estimateTokens(request) - 200;
  if (budget < 800) throw new Error(`${path} is too long for the builder model (about ${fileTokens} tokens). Try a smaller file or use the Style mode.`);
  let system = "";
  for (const [title, text] of parts) {
    if (!text) continue;
    const t = estimateTokens(text);
    const chunk = t <= budget ? text : text.slice(0, Math.max(0, budget * 3.3)) + "\n…(trimmed)";
    if (budget <= 100) break;
    system += `## ${title}\n${chunk}\n\n`;
    budget -= Math.min(t, budget);
  }
  const user =
    `File: ${path}\n` +
    (entry.summary ? `What it does: ${entry.summary}\n` : "") +
    `Current contents:\n\`\`\`${lang}\n${current || (isCss ? "/* empty */" : "")}\n\`\`\`\n\n` +
    `Change request: ${request}\n\n` +
    `Reply with the COMPLETE new contents of ${path} in one \`\`\`${lang} code block. Keep everything that the request doesn't ask to change. No explanation.`;
  const res = await app.llm.generate(
    [
      { role: "system", content: system.trim() },
      { role: "user", content: user },
    ],
    { onToken, kind: "builder-code", request: { temperature: 0.2, top_p: 0.9, max_tokens: Math.min(ctx - fileTokens - 500, reserve + 800) } },
  );
  return { code: extractCode(res.text, lang), raw: res.text, gen: res.gen };
}

// The Studio agent for apps. It works on a draft in clear steps a small model
// can handle:
//   1. Plan   – short JSON (name, emoji, list of features), output forced to valid JSON.
//   2. Write  – the complete HTML file, starting from the current app or the
//               closest starter template. Big files get SEARCH/REPLACE edits instead.
//   3. Check  – syntax check, then run it in the preview and collect errors.
//   4. Fix    – if anything failed, send the errors back (at most `maxFixes` times).
// The draft is shown live; the user accepts or discards it in Studio.
import { loadDoc, estimateTokens } from "./builder.js";
import { checkAppHtml } from "./app-runtime.js";

const words = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);

// Picks the starter template whose keywords best match the request.
export async function pickTemplate(request) {
  const { templates } = JSON.parse(await loadDoc("templates/index.json"));
  const w = words(request);
  let best = templates[0];
  let bestScore = 0;
  for (const t of templates) {
    const score = t.keywords.reduce((s, k) => s + (w.some((x) => x === k || (k.length > 3 && x.startsWith(k))) ? 1 : 0), 0);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return { ...best, html: await loadDoc("templates/" + best.file) };
}

async function pickPatterns(text, max = 2) {
  const { patterns } = JSON.parse(await loadDoc("patterns/index.json"));
  const w = words(text);
  return patterns
    .map((p) => ({ ...p, score: p.keywords.filter((k) => w.includes(k)).length }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

export function extractHtml(text) {
  const blocks = [...text.matchAll(/```([\w-]*)\s*\n([\s\S]*?)```/g)];
  const pick = blocks.filter((b) => /html/i.test(b[1]) || /<html|<body|<!doctype/i.test(b[2])).pop();
  if (pick) return pick[2].trim() + "\n";
  const open = text.match(/```(?:html)?\s*\n([\s\S]*)$/i); // ran out of tokens mid-block
  if (open) return open[1].trim() + "\n";
  const raw = text.match(/<!doctype[\s\S]*<\/html>/i) || text.match(/<html[\s\S]*<\/html>/i);
  return raw ? raw[0] + "\n" : null;
}

// Applies <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks. Returns {html, failed: [search text]}.
export function applyEdits(html, text) {
  const re = /<<<<<<< ?SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> ?REPLACE/g;
  let out = html;
  const failed = [];
  let count = 0;
  for (const m of text.matchAll(re)) {
    count++;
    const [, search, replace] = m;
    if (out.includes(search)) out = out.replace(search, replace);
    else {
      // Retry ignoring indentation differences.
      const norm = (s) => s.split("\n").map((l) => l.trim()).join("\n");
      const lines = out.split("\n");
      const target = norm(search);
      const n = search.split("\n").length;
      let done = false;
      for (let i = 0; i + n <= lines.length && !done; i++) {
        if (norm(lines.slice(i, i + n).join("\n")) === target) {
          lines.splice(i, n, ...replace.split("\n"));
          out = lines.join("\n");
          done = true;
        }
      }
      if (!done) failed.push(search.slice(0, 120));
    }
  }
  return { html: out, failed, count };
}

/**
 * opts: {
 *   llm, request, current (HTML or "" for a new app), chat (earlier [{role, content}] turns, short),
 *   check(html): Promise<string[]>  renders in the preview, resolves to runtime errors
 *   onEvent(e)  e = {type: "step", key, label, status: "running"|"done"|"error", detail}
 *                 | {type: "plan", plan} | {type: "stream", text} | {type: "draft", html}
 *   maxFixes (default 2), signal
 * }
 * Resolves to {html, plan, errors}.
 */
export async function runAppAgent(opts) {
  const { llm, request, onEvent = () => {}, signal } = opts;
  const maxFixes = opts.maxFixes ?? 2;
  const ctx = llm.contextWindow || 4096;
  const step = (key, label, status, detail) => onEvent({ type: "step", key, label, status, detail });
  const stop = () => {
    if (signal && signal.aborted) throw new Error("Stopped");
  };
  const isNew = !opts.current || !opts.current.trim();

  // ---- 1. Plan ----
  let base = opts.current;
  let template = null;
  if (isNew) {
    template = await pickTemplate(request);
    base = template.html;
  }
  step("plan", "Planning", "running");
  const planSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      emoji: { type: "string" },
      features: { type: "array", items: { type: "string" } },
    },
    required: ["name", "emoji", "features"],
  };
  const planRes = await llm.generate(
    [
      {
        role: "system",
        content:
          "You plan small offline web apps. Reply with JSON: a short app name (1-4 words), one emoji, and 3-6 concrete features " +
          "(each under 12 words) that together do what the user asked." +
          (isNew ? ` The app will start from this template: ${template.name}: ${template.description}` : " The app already exists; list only the changes to make."),
      },
      ...(opts.chat || []).slice(-4),
      { role: "user", content: request },
    ],
    { kind: "builder-plan", request: { temperature: 0.3, max_tokens: 300, response_format: { type: "json_object", schema: JSON.stringify(planSchema) } } },
  );
  stop();
  let plan;
  try {
    plan = JSON.parse(planRes.text);
  } catch {
    plan = { name: "My app", emoji: "✨", features: [request] };
  }
  plan.features = (plan.features || []).slice(0, 6);
  onEvent({ type: "plan", plan, template: template && template.name });
  step("plan", "Planning", "done", plan.features.join(" · "));

  // ---- shared context ----
  const patterns = await pickPatterns(request + " " + plan.features.join(" "));
  // Small contexts (phones: 4k) get the short appkit reference so it still fits next to the file.
  const docs = [await loadDoc("APP_RULES.md"), await loadDoc(ctx <= 4096 ? "APPKIT_SHORT.md" : "APPKIT.md")];
  for (const p of patterns) docs.push((await loadDoc("patterns/" + p.file)).replace(/^keywords:.*\n/, ""));
  const fit = (parts, budget) => {
    const out = [];
    for (const p of parts) {
      const t = estimateTokens(p);
      if (t <= budget) {
        out.push(p);
        budget -= t;
      }
    }
    return out.join("\n\n");
  };

  async function write(html, instruction, key, label) {
    step(key, label, "running");
    const fileTokens = estimateTokens(html);
    const fullRewrite = fileTokens * 2.2 + 1600 < ctx;
    const answerRoom = fullRewrite ? Math.round(fileTokens * 1.3) + 900 : 1400;
    const system = fit(docs, ctx - fileTokens - answerRoom - estimateTokens(instruction) - 300);
    const how = fullRewrite
      ? `Reply with the COMPLETE new file in one \`\`\`html block.`
      : `The file is long, so reply ONLY with edit blocks, each exactly like this:\n<<<<<<< SEARCH\n(exact lines copied from the file)\n=======\n(the new lines)\n>>>>>>> REPLACE`;
    const user = `${instruction}\n\nCurrent file:\n\`\`\`html\n${html}\n\`\`\`\n\n${how}`;
    const res = await llm.generate(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        kind: "builder-code",
        request: { temperature: 0.2, top_p: 0.9, max_tokens: Math.max(600, Math.min(ctx - fileTokens - 400, answerRoom)) },
        onToken: (t) => onEvent({ type: "stream", text: t }),
      },
    );
    stop();
    let next;
    if (fullRewrite) {
      next = extractHtml(res.text);
      if (!next) {
        step(key, label, "error", "The model didn't return an HTML file.");
        return null;
      }
    } else {
      const r = applyEdits(html, res.text);
      if (!r.count || r.failed.length === r.count) {
        step(key, label, "error", "The model's edits didn't match the file.");
        return null;
      }
      next = r.html;
    }
    onEvent({ type: "draft", html: next });
    step(key, label, "done", `${next.split("\n").length} lines`);
    return next;
  }

  async function check(html, key) {
    step(key, "Checking", "running");
    const s = checkAppHtml(html);
    let errors = s.errors;
    if (!errors.length && opts.check) errors = await opts.check(html);
    step(key, "Checking", errors.length ? "error" : "done", errors.length ? errors.slice(0, 3).join(" · ") : "No errors");
    return errors;
  }

  // ---- 2. Write ----
  const features = plan.features.map((f) => `- ${f}`).join("\n");
  const first = isNew
    ? `Build this app: ${request}\nApp name: ${plan.name}\nFeatures:\n${features}\n\nStart from the template below: keep its structure, styles and appkit.storage usage, and change it into the requested app. Set the <title> and <h1> to the app name.`
    : `Change this app as requested: ${request}\nChanges:\n${features}\nKeep everything else working as before.`;
  let html = await write(base, first, "write", isNew ? `Writing from the ${template.name} template` : "Editing the app");
  if (!html) return { html: null, plan, errors: ["no output"] };

  // ---- 3/4. Check and fix ----
  let errors = await check(html, "check-0");
  for (let i = 1; i <= maxFixes && errors.length; i++) {
    const fixed = await write(html, `This app has errors. Fix them without removing features.\nErrors:\n${errors.map((e) => "- " + e).join("\n")}`, `fix-${i}`, `Fixing errors (try ${i})`);
    if (!fixed) break;
    html = fixed;
    errors = await check(html, `check-${i}`);
  }
  return { html, plan, errors };
}

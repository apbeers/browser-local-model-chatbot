// "Customize for me": reads the usage summary, asks the coding model for a
// small structured plan (JSON-schema constrained), and applies it to a new
// custom UI with exact, deterministic edits. The model only chooses settings;
// it never writes code here, which keeps the result reliable with small models.
import { app } from "../../core/api.js";
import { h, modal, toast } from "../dom.js";
import { NAV } from "../layout.js";
import { SUGGESTIONS } from "../chat/empty-state.js";
import { prepareBuilder } from "../views/studio-model.js";

const PAGES = NAV.map(([id]) => id);
const ALWAYS = ["chat", "studio", "settings"]; // never hidden

function describe(s) {
  const top = (arr, n = 5) => arr.slice(0, n).map(([k, v]) => `${k} (${v})`).join(", ") || "none";
  return [
    `Active on ${s.activeDays} day(s), ${s.chatReplies} chat replies.`,
    `Pages opened: ${top(s.pages, 8)}.`,
    `Chat topics: ${top(s.topics, 8)}.`,
    `Models used: ${top(s.models, 3)}.`,
    `Tools used: ${top(s.toolsUsed, 5)}.`,
    `Studio requests: ${s.studioRequests}, apps opened: ${s.appsRun}, benchmark replies: ${s.benchmarks}.`,
    `Mostly on a phone: ${s.mobileShare > 0.5 ? "yes" : "no"}.`,
  ].join("\n");
}

// A sensible plan from the numbers alone (used if the model isn't available).
function heuristicPlan(s) {
  const visits = Object.fromEntries(s.pages);
  const order = [...PAGES].sort((a, b) => (visits[b] || 0) - (visits[a] || 0));
  return {
    name: "My UI",
    startPage: "chat",
    order,
    hide: PAGES.filter((p) => !ALWAYS.includes(p) && !visits[p]),
    quickPrompts: s.topics.length ? s.topics.slice(0, 4).map(([t]) => `Help me with ${t}`) : SUGGESTIONS,
    accent: "",
    compact: s.mobileShare > 0.5,
    showStats: (visits.dashboard || 0) + s.benchmarks > 0,
    reason: "Based on which pages you open and what you chat about.",
  };
}

async function modelPlan(s) {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      startPage: { type: "string", enum: PAGES },
      order: { type: "array", items: { type: "string", enum: PAGES } },
      hide: { type: "array", items: { type: "string", enum: PAGES.filter((p) => !ALWAYS.includes(p)) } },
      quickPrompts: { type: "array", items: { type: "string" } },
      accent: { type: "string" },
      compact: { type: "boolean" },
      showStats: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["name", "startPage", "order", "hide", "quickPrompts", "accent", "compact", "showStats", "reason"],
  };
  const res = await app.llm.generate(
    [
      {
        role: "system",
        content:
          "You personalize a chat app for one person, based on how they use it. Choose:\n" +
          `- name: 2-3 words for this version\n- startPage: the page to open first (${PAGES.join(", ")})\n` +
          "- order: menu order, most used first\n- hide: pages they never use (chat, studio and settings can't be hidden)\n" +
          "- quickPrompts: 4 example requests matching their chat topics, each under 12 words\n" +
          '- accent: a hex color like "#2a78d6" that suits their topics, or "" to keep the default\n' +
          "- compact: true if they mostly use a phone\n- showStats: true if they look at speed numbers or benchmarks\n- reason: one sentence explaining the choices\nReply with JSON only.",
      },
      { role: "user", content: describe(s) },
    ],
    { kind: "builder-personalize", request: { temperature: 0.3, max_tokens: 500, response_format: { type: "json_object", schema: JSON.stringify(schema) } } },
  );
  return JSON.parse(res.text);
}

function clean(plan, s) {
  const base = heuristicPlan(s);
  const p = { ...base, ...plan };
  p.order = [...new Set([...(p.order || []).filter((x) => PAGES.includes(x)), ...PAGES])];
  p.hide = (p.hide || []).filter((x) => PAGES.includes(x) && !ALWAYS.includes(x));
  if (!PAGES.includes(p.startPage) || p.hide.includes(p.startPage)) p.startPage = "chat";
  p.quickPrompts = (p.quickPrompts || []).map((x) => String(x).slice(0, 90)).filter(Boolean).slice(0, 6);
  if (!p.quickPrompts.length) p.quickPrompts = base.quickPrompts;
  if (!/^#[0-9a-f]{6}$/i.test(p.accent || "")) p.accent = "";
  return p;
}

// Applies the plan to a new custom UI. Returns the UI's id.
export async function applyPlan(plan) {
  const V = app.variants;
  const v = await V.createVariant(plan.name || "My UI");
  const def = (p) => V.readDefault(p);

  const nav = plan.order.filter((id) => !plan.hide.includes(id)).map((id) => NAV.find(([x]) => x === id));
  const layout = (await def("js/ui/layout.js")).replace(/export const NAV = \[[\s\S]*?\n\];/, `export const NAV = ${JSON.stringify(nav, null, 2)};`);
  const main = (await def("js/ui/main.js")).replace('(location.hash || "#/chat")', `(location.hash || "#/${plan.startPage}")`);
  const empty = (await def("js/ui/chat/empty-state.js")).replace(/export const SUGGESTIONS = \[[\s\S]*?\n\];/, `export const SUGGESTIONS = ${JSON.stringify(plan.quickPrompts, null, 2)};`);
  let css = `/* Made by "Customize for me": ${plan.reason || ""} */\n`;
  if (plan.accent) css += `:root { --accent: ${plan.accent}; --accent-soft: ${plan.accent}2e; }\n:root[data-theme="dark"] { --accent: ${plan.accent}; }\n@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --accent: ${plan.accent}; } }\n`;
  if (!plan.showStats) css += ".stats-strip { display: none; }\n.msg-meta span { display: none; }\n";
  if (plan.compact) css += ".messages { padding: 8px; }\n.msg { margin-bottom: 10px; }\n.composer { padding-top: 4px; }\n.empty-state { margin-top: 3vh; }\n";

  const files = { "js/ui/layout.js": layout, "js/ui/main.js": main, "js/ui/chat/empty-state.js": empty, "css/custom.css": css };
  for (const [path, text] of Object.entries(files)) {
    const ok = await app.builder.validate(path, text);
    if (!ok.ok) throw new Error(`${path}: ${ok.error}`);
    await V.writeFile(v.id, path, text, "Customize for me");
  }
  return v.id;
}

export async function personalize() {
  const s = await app.usage.summarize();
  const status = h("p", { class: "note", role: "status" });
  const out = h("div");
  const go = h("button", { class: "btn btn-primary", type: "button" }, "Design my version");
  const dlg = modal(
    "Customize for me",
    h(
      "div",
      null,
      h("p", null, "Your usage on this device (no message text):"),
      h("pre", { class: "storage-view" }, s.events ? describe(s) : "Nothing logged yet. Use the app for a while (or check the usage log is on in Settings), then try again."),
      h("div", { class: "row" }, go, h("span", { class: "note" }, "The coding model picks the menu order, start page, example prompts and look. You preview it before using it.")),
      status,
      out,
    ),
  );
  go.disabled = !s.events;
  go.onclick = async () => {
    go.disabled = true;
    let plan;
    try {
      status.textContent = "Getting the coding model ready…";
      if (await prepareBuilder((t) => (status.textContent = t))) {
        status.textContent = "Designing…";
        plan = clean(await modelPlan(s), s);
      }
    } catch (err) {
      status.textContent = `The model's plan didn't work (${err.message}); using one based on the numbers instead.`;
    }
    plan = plan || clean({}, s);
    if (!status.textContent.startsWith("The model")) status.textContent = "";
    const labels = Object.fromEntries(NAV.map(([id, label]) => [id, label]));
    out.replaceChildren(
      h(
        "div",
        { class: "card" },
        h("h3", { class: "card-title" }, plan.name),
        h("p", { class: "note" }, plan.reason),
        h(
          "dl",
          { class: "kv" },
          h("dt", null, "Opens on"),
          h("dd", null, labels[plan.startPage]),
          h("dt", null, "Menu"),
          h("dd", null, plan.order.filter((p) => !plan.hide.includes(p)).map((p) => labels[p]).join(" · ")),
          h("dt", null, "Hidden"),
          h("dd", null, plan.hide.map((p) => labels[p]).join(", ") || "nothing"),
          h("dt", null, "Example prompts"),
          h("dd", null, plan.quickPrompts.join(" · ")),
          h("dt", null, "Look"),
          h("dd", null, [plan.accent ? `accent ${plan.accent}` : "default colors", plan.compact ? "compact" : "", plan.showStats ? "speed numbers shown" : "speed numbers hidden"].filter(Boolean).join(", ")),
        ),
        h(
          "div",
          { class: "row", style: "margin-top:12px" },
          h(
            "button",
            {
              class: "btn btn-primary",
              type: "button",
              onclick: async () => {
                try {
                  const id = await applyPlan(plan);
                  app.emit("usage", { event: "personalize" });
                  dlg.close();
                  toast("Created. Preview it, then choose “Use this UI”.");
                  location.hash = `#/studio/ui/${id}`;
                } catch (err) {
                  status.textContent = "Couldn't create it: " + err.message;
                }
              },
            },
            "Create this UI",
          ),
        ),
      ),
    );
    go.disabled = false;
  };
}

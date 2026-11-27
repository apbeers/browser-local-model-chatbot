// Usage log: what features are used, stored only on this device, one file per
// month (app/usage/YYYY-MM.jsonl, one JSON event per line). Never stores
// message text. With topic labels on, each chat also gets a 1-3 word topic
// made by the on-device model after its first reply.
//
// Event: {t: timestamp, e: name, ...details}. Names include page, model-load,
// generation, studio-*, app-*, tools-*, chat-topic, theme, settings.
import { readText, writeText, list, remove } from "./opfs.js";
import { getSettings } from "./retention.js";

const DIR = "app/usage";
let buffer = [];
let timer = null;

const monthFile = (t) => `${DIR}/${new Date(t).toISOString().slice(0, 7)}.jsonl`;

export async function enabled() {
  return (await getSettings()).usageLog !== false;
}

export function log(e, details = {}) {
  buffer.push({ t: Date.now(), e, ...details });
  clearTimeout(timer);
  timer = setTimeout(flush, 5000);
}

// Writes run one at a time: each appends to the file it just read, so two at
// once would lose lines.
// Other windows append to the same file too, so a Web Lock serializes writes
// across every open window of the app (falls back to this window only).
let writing = Promise.resolve();
const locked = (fn) => (navigator.locks ? navigator.locks.request("usage-write", fn) : fn());
export function flush() {
  writing = writing.then(() => locked(flushNow), () => locked(flushNow));
  return writing;
}

async function flushNow() {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  if (!(await enabled())) return;
  const byFile = {};
  for (const ev of batch) (byFile[monthFile(ev.t)] ||= []).push(JSON.stringify(ev));
  for (const [file, lines] of Object.entries(byFile)) {
    const prev = (await readText(file)) || "";
    await writeText(file, prev + lines.join("\n") + "\n");
  }
}

export async function readEvents({ months = 3 } = {}) {
  await flush();
  const files = (await list(DIR)).filter((e) => e.name.endsWith(".jsonl")).map((e) => e.name).sort().slice(-months);
  const out = [];
  for (const f of files) {
    for (const line of ((await readText(`${DIR}/${f}`)) || "").split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip a broken line */
      }
    }
  }
  return out;
}

export async function clear() {
  buffer = [];
  await remove(DIR, true);
}

// Counts that describe how this person uses the app (no message text).
export async function summarize() {
  const ev = await readEvents({ months: 3 });
  const count = (pred) => ev.filter(pred).length;
  const tally = (arr) => Object.entries(arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const pages = tally(ev.filter((x) => x.e === "page").map((x) => x.page));
  const models = tally(ev.filter((x) => x.e === "generation" && x.kind === "chat").map((x) => x.model));
  const topics = tally(ev.filter((x) => x.e === "chat-topic").map((x) => x.topic.toLowerCase()));
  const days = new Set(ev.map((x) => new Date(x.t).toISOString().slice(0, 10))).size;
  const hours = tally(ev.filter((x) => x.e === "page").map((x) => new Date(x.t).getHours()));
  return {
    since: ev.length ? ev[0].t : null,
    events: ev.length,
    activeDays: days,
    pages, // [[page, visits]]
    chatReplies: count((x) => x.e === "generation" && x.kind === "chat"),
    models, // [[model id, replies]]
    topics, // [[topic, chats]]
    toolsUsed: tally(ev.filter((x) => x.e === "tools-used").flatMap((x) => x.tools || [])),
    studioRequests: count((x) => x.e === "studio-request"),
    appsRun: count((x) => x.e === "app-run"),
    benchmarks: count((x) => x.e === "generation" && x.kind === "benchmark"),
    themeChanges: count((x) => x.e === "theme"),
    busiestHours: hours.slice(0, 3).map(([h]) => Number(h)),
    mobileShare: ev.length ? count((x) => x.e === "page" && x.mobile) / Math.max(1, count((x) => x.e === "page")) : 0,
  };
}

// Gives a chat a 1-3 word topic using the loaded model (once per chat).
export async function labelChat(llm, chat) {
  const s = await getSettings();
  if (s.usageLog === false || s.usageTopics === false || chat.topic || !llm.modelId || llm.state !== "ready") return null;
  const firstUser = (chat.messages.find((m) => m.role === "user") || {}).content || "";
  if (!firstUser) return null;
  const res = await llm.generate(
    [
      { role: "system", content: 'Give the topic of this request in 1 to 3 plain words, like "cooking", "python code", "travel plans". Reply with JSON {"topic": "..."}.' },
      { role: "user", content: firstUser.slice(0, 600) },
    ],
    { kind: "usage-topic", request: { temperature: 0, max_tokens: 24, response_format: { type: "json_object", schema: JSON.stringify({ type: "object", properties: { topic: { type: "string" } }, required: ["topic"] }) } } },
  );
  let topic = null;
  try {
    topic = String(JSON.parse(res.text).topic || "").slice(0, 40).trim();
  } catch {
    return null;
  }
  if (topic) log("chat-topic", { topic });
  return topic;
}

// Wire up automatic logging. Called once by app.init().
export function attach(app) {
  app.on("usage", (d) => {
    const { event, ...rest } = d || {};
    if (event) log(event, rest);
  });
  app.llm.addEventListener("loaded", (e) => log("model-load", { model: e.detail.model.id, ms: e.detail.session ? e.detail.session.r.load.totalMs : null }));
  app.llm.addEventListener("generation", (e) => log("generation", { kind: e.detail.kind, model: app.llm.modelId, tokens: e.detail.completionTokens, ms: e.detail.e2eMs }));
  app.llm.addEventListener("unloaded", (e) => log("model-unload", { model: e.detail.model.id, reason: e.detail.reason }));
  addEventListener("pagehide", () => flush());
  addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

// A workspace edits either a Studio app or a custom UI of this chatbot.
// Both are wrapped in the same "adapter" shape so the tabs don't care which:
//   name, kind, files() -> [{path, summary}], read(path), draft(path) (null = no draft),
//   hasDraft(), writeDraft(path, text), accept(note), discard(),
//   history() -> [{i, at, note, path}], revert(i), mountPreview(box, {draft, onLog}),
//   runAgent(request, {chat, path, onEvent, signal, check})
import { app } from "../../core/api.js";
import { toast } from "../dom.js";

// ---------- Studio app ----------
export async function appAdapter(id) {
  const info = await app.apps.getApp(id);
  if (!info) return null;
  const A = app.apps;
  return {
    kind: "app",
    id,
    info,
    name: info.name,
    files: async () => [{ path: "index.html", summary: "The whole app: HTML, CSS and JavaScript in one file." }],
    read: () => A.readApp(id),
    draft: () => A.readDraft(id),
    hasDraft: async () => (await A.readDraft(id)) != null,
    writeDraft: (path, text) => A.writeDraft(id, text),
    accept: (note) => A.acceptDraft(id, note),
    discard: () => A.discardDraft(id),
    history: async () => (await A.getHistory(id)).map((e, i) => ({ ...e, i, path: "index.html" })).reverse(),
    revert: (i) => A.revert(id, i),
    async mountPreview(box, { draft, onLog }) {
      const html = (draft && (await A.readDraft(id))) ?? (await A.readApp(id));
      const m = A.mount(box, { appId: id, html, onLog, onNotify: (t) => toast(t) });
      return { reload: async (useDraft) => m.load((useDraft && (await A.readDraft(id))) ?? (await A.readApp(id))), show: (html) => m.load(html), destroy: () => m.destroy(), frame: m.iframe };
    },
    async runAgent(request, { chat, onEvent, signal, check }) {
      const current = (await A.readDraft(id)) ?? (await A.readApp(id));
      const res = await app.agent.runAppAgent({ llm: app.llm, request, current, chat, onEvent, signal, check });
      if (res.html) {
        await A.writeDraft(id, res.html);
        // Name new apps from the plan.
        if (!current.trim() && res.plan) await A.updateApp(id, { name: res.plan.name || info.name, emoji: res.plan.emoji || info.emoji, description: request });
      }
      return res;
    },
    getChat: () => A.getAppChat(id),
    saveChat: (msgs) => A.saveAppChat(id, msgs),
  };
}

// ---------- custom UI of the chatbot ----------
const pendingByUi = new Map(); // ui id -> {path: text} (the draft lives in Cache Storage + here)

export async function uiAdapter(id) {
  const V = app.variants;
  const v = await V.getVariant(id);
  if (!v) return null;
  const index = await app.builder.fileIndex();
  const pending = pendingByUi.get(id) || {};
  pendingByUi.set(id, pending);
  const read = async (path) => (await V.readFile(id, path)) ?? (await V.readDefault(path)) ?? "";
  const stage = () => V.stageDraft(id, pending);
  let chat = [];
  return {
    kind: "ui",
    id,
    info: v,
    name: v.name,
    files: async () => {
      const changed = await V.listFiles(id);
      const known = index.files.map((f) => f.path);
      return [...index.files.map((f) => ({ path: f.path, summary: f.summary, changed: changed.includes(f.path) })), ...changed.filter((p) => !known.includes(p)).map((p) => ({ path: p, summary: "Added in this UI", changed: true }))];
    },
    read,
    readDefault: (path) => V.readDefault(path),
    draft: async (path) => (path ? (pending[path] ?? null) : Object.keys(pending).length ? pending : null),
    hasDraft: async () => Object.keys(pending).length > 0,
    async writeDraft(path, text) {
      pending[path] = text;
      await stage();
    },
    async accept(note) {
      for (const [p, text] of Object.entries(pending)) await V.writeFile(id, p, text, note);
      for (const k of Object.keys(pending)) delete pending[k];
      await V.clearDraft(id);
    },
    async discard() {
      for (const k of Object.keys(pending)) delete pending[k];
      await V.clearDraft(id);
    },
    history: async () => (await V.getHistory(id)).map((e, i) => ({ ...e, i })).reverse(),
    revert: (i) => V.revert(id, i),
    async mountPreview(box, { draft, onLog }) {
      const frame = document.createElement("iframe");
      frame.className = "app-frame";
      frame.title = "Preview of " + v.name;
      const url = (useDraft) => `./?ui=${encodeURIComponent(useDraft && Object.keys(pending).length ? V.draftId(id) : id)}#/chat`;
      frame.addEventListener("load", () => {
        // Same origin: listen for errors inside the preview.
        try {
          const w = frame.contentWindow;
          w.addEventListener("error", (e) => onLog && onLog({ level: "error", text: e.message + (e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : "") }));
          w.addEventListener("unhandledrejection", (e) => onLog && onLog({ level: "error", text: String(e.reason && e.reason.message ? e.reason.message : e.reason) }));
          const ce = w.console.error.bind(w.console);
          w.console.error = (...a) => (onLog && onLog({ level: "error", text: a.map(String).join(" ") }), ce(...a));
        } catch {
          /* ignore */
        }
      });
      frame.src = url(draft);
      box.append(frame);
      return {
        reload: (useDraft) => {
          frame.src = url(useDraft) + "&r=" + Date.now();
        },
        destroy: () => frame.remove(),
        frame,
      };
    },
    // Edits one file (path) with the coding model, then checks it in the preview.
    async runAgent(request, { path, onEvent, signal, check }) {
      const step = (key, label, status, detail) => onEvent({ type: "step", key, label, status, detail });
      let current = pending[path] ?? (await read(path));
      let req = request;
      for (let attempt = 0; attempt < 2; attempt++) {
        const key = attempt ? "fix" : "write";
        step(key, attempt ? "Fixing errors" : `Editing ${path}`, "running");
        const out = await app.builder.generateFile(app, { path, current, request: req, onToken: (t) => onEvent({ type: "stream", text: t }) });
        if (signal && signal.aborted) throw new Error("Stopped");
        const valid = await app.builder.validate(path, out.code);
        if (!valid.ok) {
          step(key, attempt ? "Fixing errors" : `Editing ${path}`, "error", valid.error);
          req = `${request}\nYour last answer had this error, fix it: ${valid.error}`;
          continue;
        }
        pending[path] = out.code;
        await stage();
        onEvent({ type: "draft", html: out.code });
        step(key, attempt ? "Fixing errors" : `Editing ${path}`, "done");
        step("check", "Checking the preview", "running");
        const errors = check ? await check(out.code) : [];
        step("check", "Checking the preview", errors.length ? "error" : "done", errors.slice(0, 3).join(" · ") || "No errors");
        if (!errors.length) return { html: out.code, errors };
        current = out.code;
        req = `${request}\nThe preview shows these errors, fix them:\n${errors.join("\n")}`;
      }
      return { html: pending[path] || null, errors: ["Could not produce working code"] };
    },
    getChat: async () => chat,
    saveChat: async (m) => {
      chat = m;
    },
  };
}

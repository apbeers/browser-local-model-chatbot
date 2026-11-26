// The chat screen: opening a chat, sending messages, streaming replies.
// Messages sent to the model = project instructions (as a "system" message,
// if the chat's project has any) + the chat's messages.
import { app } from "../../core/api.js";
import { state, $ } from "../state.js";
import { h, toast, fmtNum } from "../dom.js";
import { messageEl, streamingEl } from "./message.js";
import { emptyState } from "./empty-state.js";
import { renderStats } from "./stats-strip.js";
import { loadModel, selectModel } from "./model-picker.js";
import { editProject } from "./chat-actions.js";

export function showBanner(text, error = false) {
  const b = $("banner");
  b.textContent = text;
  b.classList.toggle("error", error);
  b.hidden = false;
}
export function hideBanner() {
  $("banner").hidden = true;
}

function autosize() {
  const p = $("prompt");
  p.style.height = "auto";
  p.style.height = Math.min(p.scrollHeight, window.innerHeight * 0.4) + "px";
}

export function initChatView() {
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    if (app.llm.state === "generating") app.llm.interrupt();
    else send($("prompt").value);
  });
  $("prompt").addEventListener("input", autosize);
  $("prompt").addEventListener("keydown", (e) => {
    const touch = matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !touch && !e.isComposing) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  });
  $("toolsSelect").addEventListener("change", async () => {
    const chat = state.chat;
    chat.toolsMode = $("toolsSelect").value;
    if (chat.messages.length) await app.chats.updateChat(chat.id, { toolsMode: chat.toolsMode });
    app.emit("usage", { event: "tools-mode", mode: chat.toolsMode });
  });
  app.llm.addEventListener("state", () => {
    const gen = app.llm.state === "generating";
    $("sendBtn").classList.toggle("stop", gen);
    $("sendBtn").setAttribute("aria-label", gen ? "Stop" : "Send");
    $("sendBtn").disabled = app.llm.state === "loading";
  });
}

// Opens chat `id`, or a new empty chat when id is null.
export async function showChat(id) {
  if (id && (!state.chat || state.chat.id !== id)) {
    const chat = await app.chats.openChat(id);
    if (!chat) {
      toast("Chat not found");
      location.hash = "#/chat";
      return;
    }
    state.chat = chat;
  } else if (!id && (!state.chat || state.chat.messages.length)) {
    state.chat = app.chats.newChat({ projectId: state.newChatProject });
    const p = await app.projects.getProject(state.newChatProject);
    if (p && p.defaultModel) selectModel(p.defaultModel);
  }
  app.currentChatId = state.chat.id;
  await syncToolsSelect();
  $("title").textContent = state.chat.messages.length ? state.chat.title : "Chat";
  await renderProjectBar();
  renderMessages();
  renderStats();
}

// The chat's tool mode, else its project's, else the app setting.
async function toolsModeFor(chat) {
  if (chat.toolsMode) return chat.toolsMode;
  const p = await app.projects.getProject(chat.projectId);
  if (p && p.toolsMode) return p.toolsMode;
  return (await app.settings.get()).toolsMode || "off";
}
async function syncToolsSelect() {
  $("toolsSelect").value = await toolsModeFor(state.chat);
}

async function renderProjectBar() {
  const bar = $("projectBar");
  const p = await app.projects.getProject(state.chat && state.chat.projectId);
  bar.hidden = !p;
  if (!p) return;
  bar.replaceChildren(
    h("span", null, "Project: ", h("strong", null, p.name)),
    p.instructions ? h("span", { class: "muted" }, " · instructions on") : null,
    h("button", { class: "md-copy", type: "button", onclick: () => editProject(p).then(renderProjectBar) }, "Edit"),
  );
}

function renderMessages() {
  const box = $("messages");
  const chat = state.chat;
  if (!chat.messages.length) {
    app.projects.getProject(chat.projectId).then((project) => {
      if (state.chat === chat && !chat.messages.length)
        box.replaceChildren(
          emptyState({
            project,
            onPick: (t) => send(t),
          }),
        );
    });
    return;
  }
  const last = chat.messages.length - 1;
  box.replaceChildren(...chat.messages.map((m, i) => messageEl(m, { onRegenerate: i === last && m.role === "assistant" ? regenerate : null })));
  scrollToBottom();
}

// On phones the whole page scrolls (so Safari's glass bars show the app
// behind them); on bigger screens the message list scrolls by itself.
const scroller = () => (getComputedStyle($("messages")).overflowY === "visible" ? document.scrollingElement : $("messages"));
const scrollToBottom = () => {
  const s = scroller();
  s.scrollTop = s.scrollHeight;
};
const nearBottom = () => {
  const s = scroller();
  return s.scrollHeight - s.scrollTop - s.clientHeight < 120;
};

async function ensureModel() {
  if (!app.gpu || !app.gpu.available) {
    toast("WebGPU is not available in this browser");
    return false;
  }
  const selected = $("modelSelect").value;
  if (app.llm.modelId === selected) return true;
  return loadModel(selected);
}

export async function send(text) {
  text = (text || "").trim();
  if (!text || app.llm.state === "loading" || app.llm.state === "generating") return;
  if (!(await ensureModel())) return;
  $("prompt").value = "";
  autosize();
  const chat = state.chat;
  if (!chat.messages.length) chat.title = app.chats.titleFrom(text);
  chat.modelId = app.llm.modelId;
  chat.messages.push({ role: "user", content: text, at: Date.now() });
  if ($("messages").querySelector(".empty-state")) $("messages").replaceChildren();
  $("messages").append(messageEl(chat.messages[chat.messages.length - 1]));
  scrollToBottom();
  await app.chats.saveChat(chat);
  if (location.hash !== `#/chat/${chat.id}`) history.replaceState(null, "", `#/chat/${chat.id}`);
  $("title").textContent = chat.title;
  app.emit("chats-changed");
  await runAssistant();
}

async function regenerate() {
  const chat = state.chat;
  if (!chat || app.llm.state === "generating" || app.llm.state === "loading") return;
  if (chat.messages[chat.messages.length - 1]?.role === "assistant") chat.messages.pop();
  if (!(await ensureModel())) return;
  renderMessages();
  await runAssistant();
}

async function runAssistant() {
  const chat = state.chat;
  const project = await app.projects.getProject(chat.projectId);
  const history = chat.messages.map((m) => ({ role: m.role, content: m.content }));
  if (project && project.instructions) history.unshift({ role: "system", content: project.instructions });
  const mode = await toolsModeFor(chat);
  const stream = streamingEl(app.llm.model.label);
  $("messages").append(stream.el);
  scrollToBottom();

  state.live = { tokens: 0, tFirst: null, tps: null };
  let latest = "";
  let frame = null;
  const paint = () => {
    frame = null;
    const stick = nearBottom();
    const lv = state.live;
    stream.update(latest, lv && lv.tps ? `${fmtNum(lv.tps)} tok/s · ${lv.tokens} tok` : "Prefilling…");
    renderStats();
    if (stick) scrollToBottom();
  };
  const onToken = (text) => {
    latest = text;
    const lv = state.live;
    const now = performance.now();
    lv.tokens++;
    if (lv.tFirst === null) lv.tFirst = now;
    else lv.tps = (lv.tokens - 1) / ((now - lv.tFirst) / 1000);
    if (!frame) frame = requestAnimationFrame(paint);
  };

  const msg = { role: "assistant", content: "", at: Date.now(), model: app.llm.modelId, modelLabel: app.llm.model.label };
  try {
    let messages = history;
    if (mode !== "off") {
      stream.update("", "Deciding whether to use tools…");
      const r = await app.tools.runToolLoop(app.llm, history, {
        mode,
        onStep: (s) => {
          stream.setTools(s);
          if (s.status === "running") stream.update("", `Using ${s.tool}…`);
        },
      });
      messages = r.messages;
      if (r.calls.length) msg.tools = r.calls.map((c) => ({ ...c, result: c.result.slice(0, 1200) }));
      if (r.calls.length) app.emit("usage", { event: "tools-used", tools: r.calls.map((c) => c.tool) });
    }
    const res = await app.llm.generate(messages, { onToken, conversationId: chat.id, projectId: chat.projectId });
    const { text, gen } = res;
    msg.content = text;
    msg.stats = {
      promptTokens: gen.promptTokens,
      completionTokens: gen.completionTokens,
      contextTokens: gen.contextTokens,
      contextWindow: gen.contextWindow,
      ttftMs: gen.ttftMs,
      prefillTps: gen.prefillTps,
      decodeTps: gen.decodeTps,
      e2eMs: gen.e2eMs,
      finishReason: gen.finishReason,
      droppedMessages: res.droppedMessages || 0,
    };
  } catch (err) {
    msg.content = latest;
    msg.error = err && err.message ? err.message : String(err);
    if (app.llm.state === "error") showBanner("The GPU device was lost. Load the model again to continue.", true);
  }
  if (frame) cancelAnimationFrame(frame);
  state.live = null;
  chat.messages.push(msg);
  await app.chats.saveChat(chat);
  if (state.chat === chat) renderMessages();
  renderStats();
  app.emit("chats-changed");
  // Usage log: label the chat's topic once, after its first reply, when the model is idle.
  if (!chat.topic && !msg.error) {
    setTimeout(async () => {
      try {
        const topic = await app.usage.labelChat(app.llm, chat);
        if (topic) {
          chat.topic = topic; // keep it when the open chat is saved again
          await app.chats.updateChat(chat.id, { topic });
        }
      } catch {
        /* optional */
      }
    }, 1500);
  }
}

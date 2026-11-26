// Renders one chat message. User messages are plain text; assistant messages
// are Markdown with a row of stats underneath.
import { h, iconBtn, toast, fmtNum, fmtMs } from "../dom.js";
import { renderMarkdown } from "../markdown.js";

// The stats line under an assistant reply, as a list of short strings.
export function metaParts(m) {
  const st = m.stats;
  const parts = [];
  if (m.modelLabel) parts.push(m.modelLabel);
  if (!st) return parts;
  if (st.completionTokens != null) parts.push(`${st.completionTokens} tok`);
  if (st.decodeTps != null) parts.push(`${fmtNum(st.decodeTps)} tok/s`);
  if (st.prefillTps != null) parts.push(`prefill ${fmtNum(st.prefillTps, 0)} tok/s`);
  if (st.ttftMs != null) parts.push(`TTFT ${fmtMs(st.ttftMs)}`);
  if (st.contextTokens != null && st.contextWindow) parts.push(`ctx ${st.contextTokens}/${st.contextWindow}`);
  if (st.finishReason === "length") parts.push("hit length limit");
  if (st.finishReason === "interrupted") parts.push("stopped");
  if (st.droppedMessages) parts.push(`${st.droppedMessages} old msg dropped`);
  return parts;
}

// m: a message object. opts.onRegenerate: shown as a button when given.
export function messageEl(m, { onRegenerate } = {}) {
  if (m.role === "user") return h("div", { class: "msg msg-user" }, h("div", { class: "bubble" }, m.content));
  const meta = h(
    "div",
    { class: "msg-meta" },
    iconBtn("copy", "Copy reply", async () => {
      try {
        await navigator.clipboard.writeText(m.content);
        toast("Copied");
      } catch {
        toast("Copy failed");
      }
    }),
    onRegenerate ? iconBtn("redo", "Regenerate", onRegenerate) : null,
    metaParts(m).map((p) => h("span", null, p)),
  );
  return h(
    "div",
    { class: "msg msg-assistant" },
    m.tools && m.tools.length ? toolsEl(m.tools) : null,
    h("div", { class: "bubble", html: renderMarkdown(m.content) }),
    m.error ? h("div", { class: "msg-error" }, "Error: " + m.error) : null,
    meta,
  );
}

// "Used 2 tools" with each call's input and result.
export function toolsEl(calls) {
  return h(
    "details",
    { class: "tool-calls" },
    h("summary", null, `Used ${calls.length} tool${calls.length === 1 ? "" : "s"}: ${calls.map((c) => c.tool).join(", ")}`),
    calls.map((c) => h("div", { class: "tool-call" }, h("div", { class: "mono" }, `${c.tool}(${JSON.stringify(c.input)})`), c.result ? h("pre", null, c.result) : h("div", { class: "note" }, "running…"))),
  );
}

// A placeholder assistant message that fills in while the reply streams.
export function streamingEl(modelLabel) {
  const bubble = h("div", { class: "bubble cursor" });
  const status = h("span", null, "Prefilling…");
  const toolBox = h("div");
  const calls = [];
  const el = h("div", { class: "msg msg-assistant" }, toolBox, bubble, h("div", { class: "msg-meta" }, h("span", null, modelLabel), status));
  return {
    el,
    update(text, liveText) {
      bubble.innerHTML = renderMarkdown(text);
      status.textContent = liveText;
    },
    // s = {tool, input, status, result}
    setTools(s) {
      const i = calls.findIndex((c) => c.tool === s.tool && c.input === s.input);
      if (i >= 0) calls[i] = s;
      else calls.push(s);
      toolBox.replaceChildren(toolsEl(calls));
      toolBox.firstChild.open = true;
    },
  };
}

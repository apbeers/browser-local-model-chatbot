# js/ui/chat/message.js — one chat message
- `messageEl(message, { onRegenerate })` returns the element for a message.
  User: `<div class="msg msg-user"><div class="bubble">text</div></div>`.
  Assistant: `.msg.msg-assistant` with `.bubble` (Markdown via `renderMarkdown`), optional `.msg-error`,
  and `.msg-meta` (copy button, regenerate button, stats).
- `metaParts(message)` returns the stats strings, e.g. `["Qwen2.5 0.5B", "120 tok", "41.2 tok/s"]`.
- `streamingEl(modelLabel)` returns `{ el, update(text, statusText) }` for a reply being written.
A message: `{ role, content, at (ms timestamp), modelLabel, stats: { completionTokens, decodeTps, prefillTps, ttftMs, contextTokens, contextWindow, finishReason }, error }`.
Example: show the time: in the user branch add `h("small", { class: "muted" }, new Date(m.at).toLocaleTimeString())`.

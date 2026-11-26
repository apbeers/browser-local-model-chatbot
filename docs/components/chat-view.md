# js/ui/chat/chat-view.js — the chat page
Exports: `initChatView()`, `showChat(id | null)`, `send(text)`, `showBanner(text, isError)`, `hideBanner()`.
- `showChat(id)` opens a saved chat, or a new empty one when id is null, and renders it.
- `send(text)` makes sure the selected model is loaded, saves the user message, then `runAssistant()`.
- `runAssistant()` sends `[project instructions as "system"] + chat messages` to `app.llm.generate` and
  streams the reply into `streamingEl()` from message.js, then saves it with its stats.
- The open chat is `state.chat`. Messages are drawn by `renderMessages()` using `messageEl()`.
Keyboard: Enter sends on computers, Shift+Enter makes a new line; on touch screens Enter is a new line.

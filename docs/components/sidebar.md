# js/ui/sidebar.js — sidebar list
`initSidebar()` wires "New chat" and the search box. `renderSidebar()` redraws `state.els.chatTree`:
a "Projects" heading with a + button, each project (click to expand its chats), then "Chats" without a project.
While the search box has text it shows search results instead (`app.chats.searchChats`).
Chat rows: `<li><a href="#/chat/ID">title</a> <span class="chat-actions">⋯</span></li>`; the ⋯ opens `chatMenu(c)`.
Redraws on `app.on("chats-changed")` and `app.on("projects-changed")`.

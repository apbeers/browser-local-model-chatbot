# Main CSS classes (css/app.css)

Put new rules in css/custom.css. It loads after app.css, so the same selector wins.

## Layout
- `.app` whole page (flex row). `.sidebar` left column. `.main` right column.
- `.topbar` bar at the top of `.main`. `.topbar-title` its title.
- `.view` one page area. `.view-chat` the chat page. `.view-page` other pages. `.page` centered content.
- Phones (max-width 820px): `.sidebar` slides in; `.app.sidebar-open` shows it.

## Sidebar
- `.brand` logo + name. `.new-chat` the New chat button. `.search` the search box.
- `.nav a` page links, `.nav a.active` current page.
- `.chat-tree` list area. `.sidebar-section-title` small headings ("Projects", "Chats").
- `.project-row` a project. `.chat-list li` a chat; `.chat-list li.active` the open chat.

## Chat
- `.messages` scrolling message list. `.msg` one message. `.msg-user`, `.msg-assistant`.
- `.bubble` message body. `.msg-user .bubble` the user's bubble (uses `--user-bubble`).
- `.msg-meta` stats line under a reply. `.msg-error` error text.
- `.stats-strip` live numbers row. `.stat`, `.stat-label`, `.stat-value`, `.stat-sub`.
- `.composer` message box area. `.composer-inner` its rounded box. `#prompt` the textarea. `.send-btn`.
- `.empty-state` new-chat screen. `.suggestion` suggestion buttons.
- `.md-code` code block in a reply. `.md-table` table in a reply.

## Common parts
- `.btn`, `.btn-primary`, `.btn-danger`, `.btn-sm`, `.icon-btn`.
- `.card` bordered box. `.input`, `.select` form fields. `.badge`, `.badge.good`, `.badge.bad`.
- `.toast` pop-up message. `dialog` dialogs; `.dialog-head`, `.dialog-body`.
- `.table` data table. `.kpi` number tile on the dashboard. `.chart-card` a chart.

## Example: rounder bubbles and a wider sidebar
```css
:root { --sidebar-w: 320px; }
.msg-user .bubble { border-radius: 24px; padding: 12px 18px; }
.msg-assistant .bubble { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 12px 16px; }
```

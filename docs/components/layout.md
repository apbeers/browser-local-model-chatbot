# js/ui/layout.js — page skeleton
`buildLayout(root)` creates the sidebar, top bar and one `<section>` per page, and saves the
important elements in `state.els` (read them with `$("name")` from state.js).
Names: `sidebar, newChat, search, chatTree, sidebarFoot, scrim, openSidebar, closeSidebar, title,
modelSelect, loadBtn, modelBar, statsToggle, banner, loadbar, loadText, loadPct, loadFill, projectBar,
statsStrip, messages, prompt, sendBtn, composer, views` (`views.chat`, `views.models`, ...).
Other files depend on these names: keep them when you move things around.
`NAV` = `[[id, label, svgPath], ...]` controls the sidebar links. `setSidebar(open)` opens the phone menu.
Example: move the stats strip below the messages: in `e.views.chat = h(...)` put `e.statsStrip` after `e.messages`.

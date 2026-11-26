// Builds the page skeleton inside #root and stores the important elements in
// state.els so other UI files can find them: state.els.messages, .prompt, ...
import { h } from "./dom.js";
import { state } from "./state.js";

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
export const NAV = [
  ["chat", "Chat", "M4 5h16v11H9l-5 4z"],
  ["models", "Models", "M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4"],
  ["dashboard", "Stats dashboard", "M4 20V10M10 20V4M16 20v-7M22 20H2"],
  ["benchmark", "Benchmark", "M12 21a9 9 0 1 1 9-9M12 12l5-5"],
  ["studio", "Studio", "M4 20h4L19 9l-4-4L4 16zM14 6l4 4"],
  ["settings", "Settings", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"],
];

export function buildLayout(root) {
  const e = state.els;
  e.sidebar = h(
    "aside",
    { class: "sidebar", id: "sidebar", "aria-label": "Navigation" },
    h(
      "div",
      { class: "sidebar-head" },
      h("a", { class: "brand", href: "#/chat" }, h("img", { src: "icons/icon.svg", alt: "", width: 24, height: 24 }), h("span", null, "Local LLM Bench")),
      (e.closeSidebar = h("button", { class: "icon-btn only-mobile", type: "button", "aria-label": "Close menu", html: svg("M6 6l12 12M18 6L6 18") })),
    ),
    (e.newChat = h("button", { class: "btn btn-primary new-chat", type: "button", html: svg("M12 5v14M5 12h14") + "New chat" })),
    (e.search = h("input", { class: "input search", type: "search", placeholder: "Search chats", "aria-label": "Search chats" })),
    h("nav", { class: "nav" }, NAV.map(([id, label, d]) => h("a", { href: `#/${id}`, dataset: { nav: id }, html: svg(d) + label }))),
    (e.chatTree = h("div", { class: "chat-tree", "aria-label": "Projects and chats" })),
    (e.sidebarFoot = h("div", { class: "sidebar-foot" })),
  );
  e.scrim = h("div", { class: "scrim", hidden: true });
  e.openSidebar = h("button", { class: "icon-btn only-mobile", type: "button", "aria-label": "Open menu", html: svg("M4 7h16M4 12h16M4 17h16") });
  e.title = h("div", { class: "topbar-title" }, "Chat");
  e.modelSelect = h("select", { class: "select", id: "model-select", "aria-label": "Model" });
  e.loadBtn = h("button", { class: "btn", type: "button" }, "Load");
  e.modelBar = h("div", { class: "model-bar" }, e.modelSelect, e.loadBtn);
  e.statsToggle = h("button", { class: "icon-btn", type: "button", "aria-label": "Toggle live stats", "aria-pressed": "true", title: "Live stats", html: svg("M3 12h4l3-8 4 16 3-8h4") });

  e.banner = h("div", { class: "banner", hidden: true });
  e.loadText = h("span", null, "Loading…");
  e.loadPct = h("span");
  e.loadFill = h("div", { class: "progress-fill" });
  e.loadbar = h("div", { class: "loadbar", hidden: true }, h("div", { class: "loadbar-text" }, e.loadText, e.loadPct), h("div", { class: "progress" }, e.loadFill));
  e.projectBar = h("div", { class: "project-bar", hidden: true });
  e.statsStrip = h("div", { class: "stats-strip" });
  e.messages = h("div", { class: "messages", "aria-live": "polite" });
  e.prompt = h("textarea", { id: "prompt", rows: 1, placeholder: "Message the model…", enterkeyhint: "send", "aria-label": "Message" });
  e.sendBtn = h("button", {
    class: "send-btn",
    type: "submit",
    "aria-label": "Send",
    html: '<svg class="i-send" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg><svg class="i-stop" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
  });
  e.composer = h(
    "form",
    { class: "composer", autocomplete: "off" },
    h("div", { class: "composer-inner" }, e.prompt, e.sendBtn),
    h("div", { class: "composer-hint" }, "Runs entirely on this device. Nothing leaves your browser."),
  );

  e.views = {};
  e.views.chat = h("section", { class: "view view-chat", dataset: { view: "chat" } }, e.banner, e.loadbar, e.projectBar, e.statsStrip, e.messages, e.composer);
  for (const [id] of NAV.slice(1)) e.views[id] = h("section", { class: "view view-page", dataset: { view: id }, hidden: true });
  e.views.run = h("section", { class: "view view-run", dataset: { view: "run" }, hidden: true });

  e.app = h(
    "div",
    { class: "app" },
    e.sidebar,
    e.scrim,
    h("main", { class: "main" }, h("header", { class: "topbar" }, e.openSidebar, e.title, e.modelBar, e.statsToggle), ...Object.values(e.views)),
  );
  root.replaceChildren(e.app, h("div", { class: "toast", id: "toast", role: "status", hidden: true }));
  return e;
}

export function setSidebar(open) {
  state.els.app.classList.toggle("sidebar-open", open);
  state.els.scrim.hidden = !open;
}

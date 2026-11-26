// Studio workspace, like a small offline code editor:
//   desktop: agent chat on the left, tabs on the right (Preview, Files, Changes, Console)
//   phones:  one panel at a time, switched with a bottom tab bar (Chat + the four tabs)
// It works the same for apps and custom UIs through an adapter (adapters.js).
import { app } from "../../core/api.js";
import { h, toast, confirmDialog } from "../dom.js";
import { agentPanel } from "./agent-panel.js";
import { previewTab } from "./preview-tab.js";
import { filesTab } from "./files-tab.js";
import { changesTab } from "./changes-tab.js";
import { consoleTab } from "./console-tab.js";

const TABS = [
  ["chat", "Chat"],
  ["preview", "Preview"],
  ["files", "Files"],
  ["changes", "Changes"],
  ["console", "Console"],
];

export async function workspace(root, adapter, { initialRequest } = {}) {
  const ws = {
    adapter,
    logs: [],
    tab: "preview",
    selectedPath: null,
    listeners: new Set(),
    // Components call ws.refresh() after anything changes; every panel re-renders.
    refresh() {
      ws.listeners.forEach((fn) => fn());
      renderDraftBar();
      renderTitle();
    },
    onRefresh(fn) {
      ws.listeners.add(fn);
    },
    show(tab) {
      // On desktop the chat is always visible; "show chat" just focuses it.
      if (tab === "chat" && !matchMedia("(max-width: 820px)").matches) {
        const box = panels.chat.querySelector("textarea");
        if (box) box.focus();
        return;
      }
      ws.tab = tab;
      for (const [name, el] of Object.entries(panels)) el.classList.toggle("active", name === tab);
      for (const b of tabButtons) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
      root.querySelector(".ws").dataset.tab = tab;
    },
    log(entry) {
      ws.logs.push({ ...entry, at: Date.now() });
      if (ws.logs.length > 500) ws.logs.shift();
      ws.listeners.forEach((fn) => fn("log"));
      updateBadges();
    },
    errors: () => ws.logs.filter((l) => l.level === "error").map((l) => l.text),
  };
  ws.selectedPath = (await adapter.files())[0].path;

  const panels = {
    chat: h("section", { class: "ws-panel ws-chat" }),
    preview: h("section", { class: "ws-panel" }),
    files: h("section", { class: "ws-panel" }),
    changes: h("section", { class: "ws-panel" }),
    console: h("section", { class: "ws-panel" }),
  };
  const tabButtons = TABS.map(([id, label]) =>
    h("button", { type: "button", role: "tab", class: "ws-tab" + (id === "chat" ? " mobile-only" : ""), dataset: { tab: id }, onclick: () => ws.show(id) }, label, h("span", { class: "ws-badge", hidden: true })),
  );
  const draftBar = h("div", { class: "ws-draftbar" });

  const updateBadges = () => {
    const errs = ws.errors().length;
    const b = tabButtons.find((x) => x.dataset.tab === "console").lastChild;
    b.hidden = !errs;
    b.textContent = errs;
  };

  async function renderTitle() {
    if (adapter.kind !== "app") return;
    const { app } = await import("../../core/api.js");
    const info = await app.apps.getApp(adapter.id);
    const el = root.querySelector(".ws-title");
    if (info && el) el.textContent = `${info.emoji || ""} ${info.name}`;
  }

  async function renderDraftBar() {
    const has = await adapter.hasDraft();
    draftBar.hidden = !has;
    if (!has) return;
    draftBar.replaceChildren(
      h("span", null, "Draft ready. Preview it, then keep or discard it."),
      h(
        "button",
        {
          class: "btn btn-sm btn-primary",
          type: "button",
          onclick: async () => {
            await adapter.accept("Accepted draft");
            toast("Saved");
            app.emit("usage", { event: "studio-accept", kind: adapter.kind });
            ws.refresh();
          },
        },
        "Keep",
      ),
      h(
        "button",
        {
          class: "btn btn-sm",
          type: "button",
          onclick: async () => {
            if (!(await confirmDialog("Discard the draft?", "The saved version stays as it is.", "Discard"))) return;
            await adapter.discard();
            ws.refresh();
          },
        },
        "Discard",
      ),
    );
  }

  root.replaceChildren(
    h(
      "div",
      { class: "ws", dataset: { tab: ws.tab } },
      h(
        "div",
        { class: "ws-head" },
        h("a", { class: "btn btn-sm", href: "#/studio" }, "← Studio"),
        h("strong", { class: "ws-title" }, (adapter.info.emoji ? adapter.info.emoji + " " : "") + adapter.name),
        h("span", { class: "badge" }, adapter.kind === "app" ? "App" : "Chatbot UI"),
        h("span", { class: "spacer" }),
        adapter.kind === "app" ? h("a", { class: "btn btn-sm", href: `#/run/${adapter.id}` }, "Open app") : null,
        adapter.kind === "app" ? h("button", { class: "btn btn-sm", type: "button", onclick: () => import("./pin.js").then((m) => m.pinApp(adapter.id)) }, "Pin") : null,
      ),
      draftBar,
      panels.chat,
      h("nav", { class: "ws-tabs", role: "tablist" }, tabButtons),
      h("div", { class: "ws-body" }, panels.preview, panels.files, panels.changes, panels.console),
    ),
  );

  agentPanel(panels.chat, ws, { initialRequest });
  await previewTab(panels.preview, ws);
  filesTab(panels.files, ws);
  changesTab(panels.changes, ws);
  consoleTab(panels.console, ws);
  ws.show(matchMedia("(max-width: 820px)").matches && initialRequest ? "chat" : "preview");
  renderDraftBar();
  return ws;
}

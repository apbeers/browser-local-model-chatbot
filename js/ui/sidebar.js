// Sidebar: "New chat", search, navigation, and the tree of projects and chats.
// Re-renders on app events "chats-changed" and "projects-changed".
import { app } from "../core/api.js";
import { state, $, lsGet, lsSet } from "./state.js";
import { h, iconBtn, icons } from "./dom.js";
import { setSidebar } from "./layout.js";
import { chatMenu, projectMenu, editProject } from "./chat/chat-actions.js";

let searchTimer = null;
let query = "";

export function initSidebar() {
  $("newChat").onclick = () => {
    state.newChatProject = null;
    state.chat = null;
    if (location.hash !== "#/chat") location.hash = "#/chat";
    else app.route();
    setSidebar(false);
    $("prompt").focus();
  };
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = $("search").value.trim();
      renderSidebar();
    }, 200);
  });
  app.on("chats-changed", () => renderSidebar());
  app.on("projects-changed", () => renderSidebar());
}

const expanded = () => new Set(JSON.parse(lsGet("openProjects", "[]")));
function toggleProject(id) {
  const s = expanded();
  s.has(id) ? s.delete(id) : s.add(id);
  lsSet("openProjects", JSON.stringify([...s]));
  renderSidebar();
}

function chatRow(c) {
  const active = state.view === "chat" && state.chat && state.chat.id === c.id;
  return h(
    "li",
    { class: active ? "active" : null },
    h("a", { href: `#/chat/${c.id}`, title: c.title }, c.title),
    h("span", { class: "chat-actions" }, iconBtn("more", "Chat options", () => chatMenu(c))),
  );
}

async function renderSearch(tree) {
  const results = await app.chats.searchChats(query);
  tree.append(h("div", { class: "sidebar-section-title" }, `Results for “${query}”`));
  if (!results.length) {
    tree.append(h("div", { class: "empty" }, "No matching chats"));
    return;
  }
  const ul = h("ul", { class: "chat-list" });
  for (const r of results) {
    const li = chatRow(r.chat);
    if (r.hits[0]) li.firstChild.append(h("span", { class: "snippet" }, r.hits[0].snippet));
    ul.append(li);
  }
  tree.append(ul);
}

export async function renderSidebar() {
  const tree = $("chatTree");
  if (!tree) return;
  const frag = h("div");
  if (query) {
    await renderSearch(frag);
    tree.replaceChildren(...frag.childNodes);
    return;
  }
  const [projects, chats] = await Promise.all([app.projects.listProjects(), app.chats.listChats()]);
  const open = expanded();

  frag.append(
    h(
      "div",
      { class: "sidebar-section-title row" },
      h("span", { class: "spacer" }, "Projects"),
      iconBtn("plus", "New project", async () => {
        const p = await editProject(null);
        if (p) toggleProject(p.id);
      }),
    ),
  );
  if (!projects.length) frag.append(h("div", { class: "empty" }, "Group related chats into a project."));
  for (const p of projects) {
    const mine = chats.filter((c) => c.projectId === p.id);
    const isOpen = open.has(p.id) || (state.chat && state.chat.projectId === p.id);
    frag.append(
      h(
        "div",
        { class: "project-row" + (isOpen ? " open" : "") },
        h("button", { type: "button", class: "project-toggle", "aria-expanded": String(isOpen), onclick: () => toggleProject(p.id), html: icons.folder }, h("span", null, p.name), h("small", null, String(mine.length))),
        iconBtn("more", "Project options", () => projectMenu(p)),
      ),
    );
    if (isOpen) {
      const ul = h("ul", { class: "chat-list nested" });
      ul.append(
        h(
          "li",
          null,
          h(
            "a",
            {
              href: "#/chat",
              class: "new-in-project",
              onclick: (e) => {
                e.preventDefault();
                state.chat = null;
                state.newChatProject = p.id;
                location.hash === "#/chat" ? app.route() : (location.hash = "#/chat");
              },
            },
            "+ New chat in project",
          ),
        ),
      );
      mine.forEach((c) => ul.append(chatRow(c)));
      frag.append(ul);
    }
  }
  const loose = chats.filter((c) => !c.projectId);
  frag.append(h("div", { class: "sidebar-section-title" }, "Chats"));
  if (!loose.length) frag.append(h("div", { class: "empty" }, "No saved chats yet"));
  const ul = h("ul", { class: "chat-list" });
  loose.forEach((c) => ul.append(chatRow(c)));
  frag.append(ul);
  tree.replaceChildren(...frag.childNodes);
}

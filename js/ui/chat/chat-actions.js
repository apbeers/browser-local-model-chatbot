// Menus and dialogs for chats and projects: rename, move, export, delete,
// and the project editor (name, instructions, default model, auto-delete).
import { app } from "../../core/api.js";
import { state } from "../state.js";
import { h, toast, confirmDialog, promptDialog, modal, downloadFile } from "../dom.js";

const safeName = (s) => s.replace(/[^\w-]+/g, "_").slice(0, 40) || "chat";

// A simple list of buttons in a dialog.
function actionSheet(title, actions) {
  let dlg;
  const body = h(
    "div",
    { class: "action-sheet" },
    actions.filter(Boolean).map(([label, fn, danger]) =>
      h(
        "button",
        {
          type: "button",
          class: "btn" + (danger ? " btn-danger" : ""),
          onclick: () => {
            dlg.close();
            fn();
          },
        },
        label,
      ),
    ),
  );
  dlg = modal(title, body);
}

async function exportChats(ids, name, format) {
  const text = await app.chats.exportChats(ids, format);
  downloadFile(`${safeName(name)}.${format === "md" ? "md" : "json"}`, text, format === "md" ? "text/markdown" : "application/json");
}

async function afterDelete(ids) {
  if (state.chat && ids.includes(state.chat.id)) {
    state.chat = null;
    location.hash = "#/chat";
  }
  app.emit("chats-changed");
}

export function chatMenu(c) {
  actionSheet(c.title, [
    [
      "Rename",
      async () => {
        const t = await promptDialog("Rename chat", c.title);
        if (!t) return;
        await app.chats.renameChat(c.id, t);
        if (state.chat && state.chat.id === c.id) state.chat.title = t;
        app.emit("chats-changed");
      },
    ],
    ["Move to project…", () => moveDialog(c)],
    ["Export as Markdown", () => exportChats([c.id], c.title, "md")],
    ["Export as JSON", () => exportChats([c.id], c.title, "json")],
    [
      "Delete",
      async () => {
        if (!(await confirmDialog("Delete chat?", `“${c.title}” will be removed from this device.`))) return;
        await app.chats.deleteChat(c.id);
        afterDelete([c.id]);
      },
      true,
    ],
  ]);
}

async function moveDialog(c) {
  const projects = await app.projects.listProjects();
  const sel = h("select", { class: "select", style: "width:100%" }, h("option", { value: "" }, "No project"), projects.map((p) => h("option", { value: p.id, selected: p.id === c.projectId ? true : null }, p.name)));
  let dlg;
  dlg = modal(
    "Move chat",
    h(
      "div",
      null,
      sel,
      h(
        "div",
        { class: "row", style: "justify-content:flex-end;margin-top:14px" },
        h(
          "button",
          {
            class: "btn btn-primary",
            type: "button",
            onclick: async () => {
              await app.chats.moveChat(c.id, sel.value || null);
              if (state.chat && state.chat.id === c.id) state.chat.projectId = sel.value || null;
              dlg.close();
              app.emit("chats-changed");
            },
          },
          "Move",
        ),
      ),
    ),
  );
}

export function projectMenu(p) {
  actionSheet(p.name, [
    ["Edit project", () => editProject(p)],
    [
      "New chat in this project",
      () => {
        state.chat = null;
        state.newChatProject = p.id;
        location.hash === "#/chat" ? app.route() : (location.hash = "#/chat");
      },
    ],
    ["Export chats as Markdown", async () => exportChats((await app.chats.listChats({ projectId: p.id })).map((c) => c.id), p.name, "md")],
    ["Export chats as JSON", async () => exportChats((await app.chats.listChats({ projectId: p.id })).map((c) => c.id), p.name, "json")],
    [
      "Delete project, keep its chats",
      async () => {
        if (!(await confirmDialog("Delete project?", `“${p.name}” is removed. Its chats move to the general chat list.`))) return;
        await app.projects.deleteProject(p.id);
        app.emit("projects-changed");
        app.emit("chats-changed");
      },
      true,
    ],
    [
      "Delete project and its chats",
      async () => {
        const ids = (await app.chats.listChats({ projectId: p.id })).map((c) => c.id);
        if (!(await confirmDialog("Delete project and chats?", `“${p.name}” and its ${ids.length} chat(s) are removed from this device.`))) return;
        await app.projects.deleteProject(p.id, { deleteChatsToo: true });
        app.emit("projects-changed");
        afterDelete(ids);
      },
      true,
    ],
  ]);
}

// Create (p = null) or edit a project. Resolves to the saved project or null.
export function editProject(p) {
  return new Promise((resolve) => {
    const name = h("input", { class: "input", value: p ? p.name : "", placeholder: "Project name", style: "width:100%" });
    const instr = h("textarea", { class: "input", rows: 5, style: "width:100%;resize:vertical", placeholder: "Optional. Sent to the model at the start of every chat in this project, e.g. “You are a concise coding assistant.”" }, p ? p.instructions : "");
    const model = h("select", { class: "select", style: "width:100%" }, h("option", { value: "" }, "App default (the model picker)"));
    for (const m of app.catalog ? app.catalog.quick : []) model.append(h("option", { value: m.id, selected: p && p.defaultModel === m.id ? true : null }, m.label));
    const del = h("select", { class: "select", style: "width:100%" }, h("option", { value: "inherit" }, "Use the app setting"));
    for (const [v, label] of app.settings.AUTO_DELETE_OPTIONS) del.append(h("option", { value: String(v), selected: p && p.autoDeleteDays === v ? true : null }, label.replace("unused", "not opened")));
    const tools = h(
      "select",
      { class: "select", style: "width:100%" },
      [["", "Use the app setting"], ["off", "Off"], ["offline", "Offline tools"], ["web", "Offline tools + web"]].map(([v, l]) => h("option", { value: v, selected: (p && p.toolsMode ? p.toolsMode : "") === v ? true : null }, l)),
    );
    const field = (label, el) => h("label", { class: "field" }, h("span", null, label), el);
    let saved = null;
    const dlg = modal(
      p ? "Edit project" : "New project",
      h(
        "form",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            const data = {
              name: name.value.trim() || "Untitled project",
              instructions: instr.value.trim(),
              defaultModel: model.value || null,
              autoDeleteDays: del.value === "inherit" ? null : Number(del.value),
              toolsMode: tools.value || null,
            };
            saved = p ? await app.projects.updateProject(p.id, data) : await app.projects.createProject(data);
            app.emit("projects-changed");
            toast(p ? "Project saved" : "Project created");
            dlg.close();
          },
        },
        field("Name", name),
        field("Instructions", instr),
        field("Default model for new chats", model),
        field("Tools in this project's chats", tools),
        field("Auto-delete chats in this project", del),
        h("div", { class: "row", style: "justify-content:flex-end;margin-top:14px" }, h("button", { class: "btn btn-primary" }, p ? "Save" : "Create")),
      ),
    );
    dlg.addEventListener("close", () => resolve(saved));
    name.focus();
  });
}

// Files tab: the project's files, a code editor, and "apply to draft".
// Hand edits go into the draft (like the agent's), so they can be previewed first.
import { h, toast } from "../dom.js";

export function filesTab(panel, ws) {
  const a = ws.adapter;
  const list = h("div", { class: "fl-list" });
  const editor = h("textarea", { class: "input code-editor fl-editor", spellcheck: "false", "aria-label": "File contents" });
  const title = h("div", { class: "fl-title mono" });
  const note = h("span", { class: "note" });
  const applyBtn = h("button", { class: "btn btn-primary btn-sm", type: "button" }, "Apply to draft");
  let loadedText = "";

  async function renderList() {
    const files = await a.files();
    list.replaceChildren(
      ...files.map((f) =>
        h(
          "button",
          {
            type: "button",
            class: "fl-item" + (f.path === ws.selectedPath ? " active" : ""),
            title: f.summary || f.path,
            onclick: () => {
              ws.selectedPath = f.path;
              renderList();
              open();
            },
          },
          h("span", { class: "mono" }, f.path.replace(/^js\/ui\//, "")),
          f.changed ? h("span", { class: "badge good" }, "changed") : null,
        ),
      ),
    );
    list.hidden = files.length < 2;
  }

  async function open() {
    const path = ws.selectedPath;
    const draft = await a.draft(path);
    const text = typeof draft === "string" ? draft : await a.read(path);
    loadedText = text;
    editor.value = text;
    title.textContent = path;
    note.textContent = typeof draft === "string" ? "Showing the draft" : "Showing the saved version";
  }

  applyBtn.onclick = async () => {
    if (editor.value === loadedText) return toast("No changes");
    const path = ws.selectedPath;
    if (a.kind === "app") {
      const { app } = await import("../../core/api.js");
      const c = app.apps.check(editor.value);
      if (!c.ok) toast("Saved to draft, but: " + c.errors[0], 6000);
    } else {
      const { app } = await import("../../core/api.js");
      const v = await app.builder.validate(path, editor.value);
      if (!v.ok) return toast("Not applied: " + v.error, 6000);
    }
    await a.writeDraft(path, editor.value);
    loadedText = editor.value;
    toast("Applied to the draft");
    ws.refresh();
  };
  editor.addEventListener("keydown", (e) => {
    // Tab inserts two spaces; Ctrl/Cmd+S applies.
    if (e.key === "Tab") {
      e.preventDefault();
      editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      applyBtn.click();
    }
  });

  panel.replaceChildren(h("div", { class: "fl" }, list, h("div", { class: "fl-main" }, h("div", { class: "fl-bar" }, title, note, h("span", { class: "spacer" }), applyBtn), editor)));
  ws.onRefresh((what) => {
    if (what === "log") return;
    renderList();
    if (document.activeElement !== editor) open();
  });
  renderList();
  open();
}

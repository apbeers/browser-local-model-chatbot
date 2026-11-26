// Studio editor for one custom UI: pick a file, ask the coding model to change
// it (or edit by hand), check the result, compare with the default, and undo.
import { app } from "../../core/api.js";
import { h, toast, confirmDialog, promptDialog, relTime } from "../dom.js";
import { diffView } from "../diff.js";
import { prepareBuilder } from "./studio-model.js";

const V = () => app.variants;
const STYLE_FILE = "css/custom.css";

export async function renderEditor(page, v, { onBack, onActivate, onPreview }) {
  const index = await app.builder.fileIndex();
  let selected = STYLE_FILE;
  const sidebar = h("div", { class: "studio-files" });
  const panel = h("div", { class: "studio-panel" });

  page.append(
    h(
      "div",
      { class: "row studio-head" },
      h("button", { class: "btn", type: "button", onclick: onBack }, "← All UIs"),
      h("h1", { class: "spacer" }, v.name),
      h("button", { class: "btn", type: "button", onclick: onPreview }, "Preview"),
      h("button", { class: "btn btn-primary", type: "button", onclick: onActivate }, "Use this UI"),
    ),
    h("div", { class: "studio" }, sidebar, panel),
  );

  async function renderFiles() {
    const changed = new Set(await V().listFiles(v.id));
    const known = index.files.map((f) => f.path);
    const extra = [...changed].filter((p) => !known.includes(p));
    const row = (path, summary) =>
      h(
        "button",
        {
          type: "button",
          class: "studio-file" + (path === selected ? " active" : ""),
          onclick: () => {
            selected = path;
            renderFiles();
            renderPanel();
          },
        },
        h("span", { class: "mono" }, path.replace(/^js\/ui\//, "")),
        changed.has(path) ? h("span", { class: "badge good" }, "changed") : null,
        summary ? h("small", null, summary) : null,
      );
    sidebar.replaceChildren(
      h("div", { class: "sidebar-section-title" }, "Start here"),
      row(STYLE_FILE, "Extra styles on top of the default look"),
      h("div", { class: "sidebar-section-title" }, "Screens and parts"),
      ...index.files.filter((f) => f.path !== STYLE_FILE).map((f) => row(f.path, f.summary)),
      ...extra.map((p) => row(p, "Added in this UI")),
      h(
        "button",
        {
          class: "btn btn-sm",
          type: "button",
          style: "margin-top:8px",
          onclick: async () => {
            const p = await promptDialog("New file (js/ui/… .js or css/… .css)", "js/ui/my-part.js");
            if (!p) return;
            try {
              await V().writeFile(v.id, p, p.endsWith(".css") ? "/* new styles */\n" : "// New UI module\nimport { app } from \"../core/api.js\";\n", "New file");
              selected = p;
              renderFiles();
              renderPanel();
            } catch (e) {
              toast(e.message, 5000);
            }
          },
        },
        "+ New file",
      ),
    );
  }

  async function renderPanel() {
    const path = selected;
    const entry = index.files.find((f) => f.path === path) || {};
    const override = await V().readFile(v.id, path);
    const def = (await V().readDefault(path)) ?? "";
    const current = override ?? def;
    const lang = path.endsWith(".css") ? "css" : "js";

    // ---- Ask the model ----
    const request = h("textarea", {
      class: "input",
      rows: 3,
      style: "width:100%;resize:vertical",
      placeholder: lang === "css" ? "e.g. make the chat bubbles rounder and the sidebar narrower" : "e.g. show the message time under each reply",
    });
    const live = h("pre", { class: "studio-live", hidden: true });
    const result = h("div");
    const genBtn = h("button", { class: "btn btn-primary", type: "button" }, "Ask the coding model");
    genBtn.onclick = async () => {
      if (!request.value.trim()) return request.focus();
      genBtn.disabled = true;
      result.replaceChildren();
      live.hidden = false;
      live.textContent = "Getting the coding model ready…";
      try {
        if (!(await prepareBuilder((s) => (live.textContent = s)))) return;
        live.textContent = "";
        const out = await app.builder.generateFile(app, { path, current, request: request.value.trim(), onToken: (t) => ((live.textContent = t), (live.scrollTop = live.scrollHeight)) });
        live.hidden = true;
        showCandidate(out.code, request.value.trim());
      } catch (e) {
        live.textContent = "Failed: " + (e.message || e);
      } finally {
        genBtn.disabled = false;
      }
    };

    async function showCandidate(code, note) {
      const check = await app.builder.validate(path, code);
      result.replaceChildren(
        h("h3", { class: "card-title" }, "Suggested change"),
        check.ok ? h("p", { class: "badge good" }, "Syntax looks valid") : h("p", { class: "msg-error" }, "This code has an error and can't be saved as is: " + check.error),
        diffView(current, code),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn btn-primary", type: "button", disabled: check.ok ? null : true, onclick: async () => save(code, note) }, "Save to this UI"),
          h("button", { class: "btn", type: "button", onclick: () => (editor.value = code) }, "Edit it by hand first"),
          h("button", { class: "btn", type: "button", onclick: () => result.replaceChildren() }, "Discard"),
        ),
      );
    }

    async function save(code, note) {
      const check = await app.builder.validate(path, code);
      if (!check.ok) return toast("Not saved: " + check.error, 6000);
      await V().writeFile(v.id, path, code, note || "Edited by hand");
      toast("Saved. Preview it, or use this UI to apply it.");
      renderFiles();
      renderPanel();
    }

    // ---- Edit by hand ----
    const editor = h("textarea", { class: "input code-editor", spellcheck: "false", rows: 18 }, current);

    // ---- History ----
    const hist = (await V().getHistory(v.id)).map((e, i) => ({ ...e, i })).filter((e) => e.path === path).reverse();

    panel.replaceChildren(
      h("h2", { class: "mono", style: "margin-top:0" }, path),
      entry.summary ? h("p", { class: "note" }, entry.summary) : null,
      h("p", { class: "note" }, override == null ? "Using the default version of this file." : "This UI has its own version of this file."),
      h("div", { class: "card" }, h("h3", { class: "card-title" }, "Describe a change"), request, h("div", { class: "row", style: "margin-top:8px" }, genBtn, h("span", { class: "note" }, "Small, specific requests work best.")), live, result),
      h(
        "details",
        { class: "card" },
        h("summary", null, "Edit the code yourself"),
        editor,
        h(
          "div",
          { class: "row", style: "margin-top:8px" },
          h("button", { class: "btn btn-primary", type: "button", onclick: () => save(editor.value, "Edited by hand") }, "Save"),
          override != null
            ? h(
                "button",
                {
                  class: "btn btn-danger",
                  type: "button",
                  onclick: async () => {
                    if (!(await confirmDialog("Reset to default?", "This UI goes back to the default version of this file. You can undo it from the history."))) return;
                    await V().resetFile(v.id, path);
                    renderFiles();
                    renderPanel();
                  },
                },
                "Reset to default",
              )
            : null,
        ),
      ),
      h("details", { class: "card" }, h("summary", null, "Changes compared with the default"), diffView(def, current)),
      h(
        "details",
        { class: "card" },
        h("summary", null, `History (${hist.length})`),
        hist.length
          ? h(
              "ul",
              { class: "history" },
              hist.map((e) =>
                h(
                  "li",
                  null,
                  h("span", null, `${relTime(e.at)} · ${e.note || "change"}`),
                  h(
                    "button",
                    {
                      class: "btn btn-sm",
                      type: "button",
                      onclick: async () => {
                        await V().revert(v.id, e.i);
                        toast("Undone");
                        renderFiles();
                        renderPanel();
                      },
                    },
                    "Undo this",
                  ),
                ),
              ),
            )
          : h("p", { class: "note" }, "No changes yet."),
      ),
    );
  }

  await renderFiles();
  await renderPanel();
}

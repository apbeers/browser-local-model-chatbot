// Theme maker dialog: describe a theme for the on-device coding model, or
// pick colors by hand. Shows contrast warnings and previews live on the page.
import { app } from "../../core/api.js";
import { h, modal, toast } from "../dom.js";
import { prepareBuilder } from "./studio-model.js";

const T = () => app.themes;

// theme: existing custom theme to edit, or null for a new one. onDone runs after saving.
export function openThemeMaker(theme, onDone) {
  const base = theme ? structuredClone(theme) : { name: "My theme", light: { ...T().DEFAULT_THEME.light }, dark: { ...T().DEFAULT_THEME.dark } };
  const draft = { ...base, id: theme ? theme.id : "preview" };
  const before = { palette: document.documentElement.dataset.palette, css: (document.getElementById("custom-theme") || {}).textContent };
  let saved = false;

  const name = h("input", { class: "input", value: draft.name, style: "width:100%", "aria-label": "Theme name" });
  const desc = h("textarea", { class: "input", rows: 2, style: "width:100%;resize:vertical", placeholder: "e.g. calm forest greens, warm paper background, high contrast" });
  const status = h("p", { class: "note", role: "status" });
  const warnings = h("ul", { class: "warnings" });
  const grids = h("div", { class: "color-grids" });
  const genBtn = h("button", { class: "btn btn-primary", type: "button" }, "Design it with AI");

  const preview = () => {
    draft.name = name.value.trim() || "My theme";
    const check = T().checkTheme(draft);
    warnings.replaceChildren(...check.errors.concat(check.warnings).map((w) => h("li", null, w)));
    if (check.ok) T().applyTheme(draft);
    return check;
  };

  const renderGrids = () => {
    grids.replaceChildren(
      ...["light", "dark"].map((mode) =>
        h(
          "fieldset",
          { class: "color-grid" },
          h("legend", null, mode === "light" ? "Light mode" : "Dark mode"),
          T().THEME_KEYS.map((k) => {
            const input = h("input", { type: "color", value: draft[mode][k], "aria-label": `${mode} ${k}` });
            input.oninput = () => {
              draft[mode][k] = input.value;
              preview();
            };
            return h("label", { title: T().TOKEN_HELP[k] }, input, h("span", null, k));
          }),
        ),
      ),
    );
  };

  genBtn.onclick = async () => {
    const text = desc.value.trim();
    if (!text) return desc.focus();
    genBtn.disabled = true;
    try {
      status.textContent = "Getting the coding model ready…";
      if (!(await prepareBuilder((p) => (status.textContent = p)))) return;
      status.textContent = "Designing…";
      const out = await app.builder.generateTheme(app, text, { keys: T().THEME_KEYS, help: T().TOKEN_HELP, base: T().DEFAULT_THEME });
      for (const mode of ["light", "dark"]) for (const k of T().THEME_KEYS) if (/^#[0-9a-f]{6}$/i.test(out[mode]?.[k] || "")) draft[mode][k] = out[mode][k].toLowerCase();
      if (out.name && !theme) name.value = out.name;
      renderGrids();
      const check = preview();
      status.textContent = check.warnings.length ? "Done. Some colors may be hard to read; adjust them below or try again." : "Done. Adjust any color below, then save.";
    } catch (err) {
      status.textContent = "The model couldn't make a valid theme: " + (err.message || err) + ". Try again or rephrase.";
    } finally {
      genBtn.disabled = false;
    }
  };

  const dlg = modal(
    theme ? `Edit “${theme.name}”` : "Create a theme",
    h(
      "div",
      { class: "theme-maker" },
      h("label", { class: "field" }, h("span", null, "Describe it"), desc),
      h("div", { class: "row" }, genBtn, h("span", { class: "note" }, "Uses Qwen2.5-Coder 1.5B on this device (about 880 MB, downloaded once).")),
      status,
      h("label", { class: "field" }, h("span", null, "Name"), name),
      grids,
      warnings,
      h(
        "div",
        { class: "row", style: "justify-content:flex-end;margin-top:14px" },
        h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Cancel"),
        h(
          "button",
          {
            class: "btn btn-primary",
            type: "button",
            onclick: async () => {
              const check = preview();
              if (!check.ok) return toast("Fix the colors marked above first");
              const t = await T().saveTheme({ ...draft, id: theme ? theme.id : undefined, prompt: desc.value.trim() || undefined });
              await T().activateTheme(t.id);
              saved = true;
              toast(`Theme “${t.name}” saved and applied`);
              dlg.close();
              if (onDone) onDone(t);
            },
          },
          "Save and use",
        ),
      ),
    ),
  );
  name.oninput = preview;
  renderGrids();
  preview();
  dlg.addEventListener("close", () => {
    if (saved) return;
    // Undo the live preview.
    if (before.palette) {
      document.getElementById("custom-theme").textContent = before.css;
      document.documentElement.dataset.palette = before.palette;
    } else T().applyTheme(null);
  });
}

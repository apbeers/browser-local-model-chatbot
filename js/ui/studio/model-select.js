// The coding-model menu used on the Studio home page and in the agent chat.
// "Auto" picks by device and skips models that ran out of GPU memory here.
// The choice is saved in the "coderModel" setting.
import { app } from "../../core/api.js";
import { h } from "../dom.js";

export function coderModelSelect({ id, onChange } = {}) {
  const sel = h("select", { class: "select ag-model", id, "aria-label": "Coding model" });
  async function fill() {
    const s = await app.settings.get();
    const oom = s.oomModels || {};
    const opts = app.builder.coderOptions(app.catalog, app.gpu, oom);
    const autoId = app.builder.autoBuilderModel(app.gpu, oom);
    const auto = opts.find((o) => o.id === autoId);
    const saved = (o) => app.isSaved(app.models.findModel(app.catalog, o.id) || {});
    sel.replaceChildren(
      h("option", { value: "auto" }, `Auto · ${auto ? auto.label : "by device"}`),
      ...opts.map((o) => h("option", { value: o.id }, `${saved(o) ? "✓ " : ""}${o.oom ? "⚠ " : ""}${o.label}${o.bytes ? " · " + app.models.fmtBytes(o.bytes) : ""}${o.note ? " · " + o.note : ""}`)),
    );
    sel.value = s.coderModel && [...sel.options].some((x) => x.value === s.coderModel) ? s.coderModel : "auto";
  }
  sel.onchange = async () => {
    await app.settings.set("coderModel", sel.value);
    if (onChange) onChange(sel.value);
  };
  fill();
  app.on("out-of-memory", fill);
  app.on("models-changed", fill);
  return { el: sel, refresh: fill };
}

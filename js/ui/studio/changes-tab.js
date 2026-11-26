// Changes tab: what the draft changes, the history with undo, and (for chatbot
// UIs) how each file differs from the default.
import { h, toast, relTime } from "../dom.js";
import { diffView } from "../diff.js";

export function changesTab(panel, ws) {
  const a = ws.adapter;

  async function render() {
    const parts = [h("h3", { class: "card-title" }, "Draft")];
    if (await a.hasDraft()) {
      const files = await a.files();
      for (const f of files) {
        const d = await a.draft(f.path);
        if (typeof d !== "string") continue;
        parts.push(h("div", { class: "mono note" }, f.path), diffView(await a.read(f.path), d));
      }
    } else parts.push(h("p", { class: "note" }, "No draft. Ask the agent for a change or edit a file, and the changes show up here."));

    const hist = await a.history();
    parts.push(h("h3", { class: "card-title" }, `History (${hist.length})`));
    parts.push(
      hist.length
        ? h(
            "ul",
            { class: "history" },
            hist.slice(0, 40).map((e) =>
              h(
                "li",
                null,
                h("span", null, `${relTime(e.at)} · ${e.note || "change"}${a.kind === "ui" ? " · " + e.path : ""}`),
                h(
                  "button",
                  {
                    class: "btn btn-sm",
                    type: "button",
                    onclick: async () => {
                      await a.revert(e.i);
                      toast("Undone");
                      ws.refresh();
                    },
                  },
                  "Undo this",
                ),
              ),
            ),
          )
        : h("p", { class: "note" }, "Nothing saved yet."),
    );

    if (a.kind === "ui") {
      const changed = (await a.files()).filter((f) => f.changed);
      parts.push(h("h3", { class: "card-title" }, "Compared with the default UI"));
      if (!changed.length) parts.push(h("p", { class: "note" }, "Same as the default."));
      for (const f of changed) parts.push(h("details", { class: "card" }, h("summary", { class: "mono" }, f.path), diffView((await a.readDefault(f.path)) || "", await a.read(f.path))));
    }
    panel.replaceChildren(h("div", { class: "ch" }, ...parts));
  }
  ws.onRefresh((what) => what !== "log" && render());
  render();
}

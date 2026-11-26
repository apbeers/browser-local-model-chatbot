// The Studio agent chat: describe what to build or change; the agent plans,
// writes a draft, checks it in the preview and fixes errors. Each step shows
// live. The coding model can be picked here (auto by device, or bigger ones).
import { app } from "../../core/api.js";
import { h, toast } from "../dom.js";
import { prepareBuilder } from "../views/studio-model.js";

const ICON = { running: "◌", done: "✓", error: "!" };

export function agentPanel(panel, ws, { initialRequest } = {}) {
  const a = ws.adapter;
  let history = []; // [{role, content}]
  let controller = null;
  const msgs = h("div", { class: "ag-msgs", "aria-live": "polite" });
  const input = h("textarea", { class: "input ag-input", rows: 3, placeholder: a.kind === "app" ? "Describe what to build or change…" : "Describe a change to this file…" });
  const sendBtn = h("button", { class: "btn btn-primary", type: "button" }, "Send");
  const modelSel = h("select", { class: "select ag-model", "aria-label": "Coding model" });
  const fileSel = h("select", { class: "select", "aria-label": "File to change", hidden: a.kind !== "ui" });

  async function fillModels() {
    const s = await app.settings.get();
    const opts = app.builder.coderOptions(app.catalog, app.gpu);
    const auto = opts.find((o) => o.id === app.builder.autoBuilderModel(app.gpu));
    modelSel.replaceChildren(
      h("option", { value: "auto" }, `Auto · ${auto ? auto.label : "by device"}`),
      ...opts.map((o) => h("option", { value: o.id, selected: s.coderModel === o.id ? true : null }, `${app.isSaved(app.models.findModel(app.catalog, o.id) || {}) ? "✓ " : ""}${o.label}${o.bytes ? " · " + app.models.fmtBytes(o.bytes) : ""}${o.note ? " · " + o.note : ""}`)),
    );
    if (s.coderModel === "auto") modelSel.value = "auto";
  }
  modelSel.onchange = () => app.settings.set("coderModel", modelSel.value);

  async function fillFiles() {
    if (a.kind !== "ui") return;
    const files = await a.files();
    fileSel.replaceChildren(...files.filter((f) => f.path !== "css/app.css").map((f) => h("option", { value: f.path, selected: f.path === ws.selectedPath ? true : null }, f.path.replace(/^js\/ui\//, ""))));
  }
  fileSel.onchange = () => {
    ws.selectedPath = fileSel.value;
    ws.refresh();
  };

  const bubble = (role, text) => h("div", { class: "ag-msg ag-" + role }, text);

  // A card that shows one agent run: plan, steps and the code being written.
  function turnCard() {
    const status = h("div", { class: "note" });
    const plan = h("div");
    const steps = h("ol", { class: "ag-steps" });
    const codeLen = h("span", { class: "note" });
    const code = h("pre", { class: "studio-live" });
    const card = h("div", { class: "ag-turn" }, status, plan, steps, h("details", { class: "ag-code" }, h("summary", null, "Code being written ", codeLen), code));
    const stepEls = {};
    return {
      el: card,
      status: (t) => (status.textContent = t),
      event(e) {
        if (e.type === "plan") {
          plan.replaceChildren(
            h("div", { class: "ag-plan-title" }, `${e.plan.emoji || ""} ${e.plan.name || ""}`, e.template ? h("span", { class: "note" }, ` · from the ${e.template} template`) : null),
            h("ul", { class: "ag-plan" }, (e.plan.features || []).map((f) => h("li", null, f))),
          );
        } else if (e.type === "step") {
          let el = stepEls[e.key];
          if (!el) {
            el = stepEls[e.key] = h("li");
            steps.append(el);
          }
          el.className = "ag-step " + e.status;
          el.replaceChildren(...[h("span", { class: "ag-icon", "aria-hidden": "true" }, ICON[e.status]), h("span", null, e.label), e.detail ? h("small", null, e.detail) : null].filter(Boolean));
          status.textContent = "";
        } else if (e.type === "stream") {
          code.textContent = e.text;
          codeLen.textContent = `(${e.text.split("\n").length} lines)`;
          code.scrollTop = code.scrollHeight;
        }
        msgs.scrollTop = msgs.scrollHeight;
      },
    };
  }

  async function send(text) {
    text = (text || input.value).trim();
    if (!text || controller) return;
    input.value = "";
    msgs.append(bubble("user", text));
    const card = turnCard();
    msgs.append(card.el);
    msgs.scrollTop = msgs.scrollHeight;
    sendBtn.textContent = "Stop";
    controller = new AbortController();
    app.emit("usage", { event: "studio-request", kind: a.kind });
    let summary;
    try {
      card.status("Getting the coding model ready…");
      if (!(await prepareBuilder((s) => card.status(s)))) throw new Error("The coding model isn't available.");
      fillModels();
      const run = () => a.runAgent(text, { chat: history.slice(-4), path: ws.selectedPath, signal: controller.signal, onEvent: (e) => card.event(e), check: (html) => ws.preview.check(html) });
      let res;
      try {
        res = await run();
      } catch (err) {
        if (!err.gpuLost || controller.signal.aborted) throw err;
        // The GPU dropped the model (usually memory on phones): reload it and try once more.
        card.status("The GPU ran out of memory and dropped the model. Reloading it and trying again…");
        if (!(await prepareBuilder((s) => card.status(s)))) throw err;
        res = await run();
      }
      const errs = res.errors || [];
      summary = !res.html ? "I couldn't produce a working version. Try rephrasing or a smaller change." : errs.length ? `Draft ready, but ${errs.length} error(s) remain. Check the Console, ask me to fix them, or edit the file.` : "Draft ready. Look at the Preview, then Keep or Discard it.";
      if (res.plan) summary = `${res.plan.emoji || ""} ${res.plan.name}: ${res.plan.features.join("; ")}. ` + summary;
    } catch (err) {
      summary = err.gpuLost
        ? "Stopped: the GPU ran out of memory and dropped the model twice. Close other tabs and apps and try again, or pick a smaller coding model above."
        : "Stopped: " + (err.message || err);
    } finally {
      controller = null;
      sendBtn.textContent = "Send";
    }
    msgs.append(bubble("assistant", summary));
    history.push({ role: "user", content: text }, { role: "assistant", content: summary });
    await a.saveChat(history);
    msgs.scrollTop = msgs.scrollHeight;
    ws.refresh();
    if (matchMedia("(max-width: 820px)").matches) ws.show("preview");
  }
  ws.agentSend = send;

  sendBtn.onclick = () => {
    if (controller) {
      controller.abort();
      app.llm.interrupt();
      toast("Stopping…");
    } else send();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) {
      e.preventDefault();
      send();
    }
  });

  panel.replaceChildren(
    h("div", { class: "ag-head" }, h("label", { class: "note" }, "Model"), modelSel),
    msgs,
    h("div", { class: "ag-composer" }, fileSel, input, h("div", { class: "row" }, h("span", { class: "note spacer" }, "Small, specific requests work best."), sendBtn)),
  );
  fillModels();
  fillFiles();
  ws.onRefresh((what) => what !== "log" && fillFiles());

  (async () => {
    history = (await a.getChat()) || [];
    if (!history.length) msgs.append(h("p", { class: "note ag-hint" }, a.kind === "app" ? "Tell me what this app should do. I'll plan it, write a draft and test it in the preview." : "Pick a file above (start with custom.css for looks), then describe the change."));
    for (const m of history) msgs.append(bubble(m.role, m.content));
    msgs.scrollTop = msgs.scrollHeight;
    if (initialRequest) send(initialRequest);
  })();
}

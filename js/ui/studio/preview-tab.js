// Preview tab: a small built-in browser for the app or UI, with device sizes.
// Also gives the agent ws.preview.check(html): render it and collect errors.
import { h } from "../dom.js";
import { lsGet, lsSet } from "../state.js";

export const DEVICES = [
  ["fit", "Fit", null],
  ["phone", "Phone", [390, 844]],
  ["tablet", "Tablet", [820, 1180]],
  ["desktop", "Desktop", [1440, 900]],
  ["ultrawide", "Ultrawide", [2560, 1080]],
];

export async function previewTab(panel, ws) {
  const a = ws.adapter;
  let device = lsGet("studioDevice", "fit");
  let showDraft = true;
  const stage = h("div", { class: "pv-stage" });
  const frameBox = h("div", { class: "pv-frame" });
  stage.append(frameBox);
  const deviceSel = h(
    "select",
    { class: "select", "aria-label": "Screen size" },
    DEVICES.map(([id, label, size]) => h("option", { value: id, selected: id === device ? true : null }, size ? `${label} ${size[0]}×${size[1]}` : label)),
  );
  const which = h("div", { class: "seg", role: "group", "aria-label": "Version" });
  const draftBtn = h("button", { type: "button", "aria-pressed": "true", onclick: () => setDraft(true) }, "Draft");
  const savedBtn = h("button", { type: "button", "aria-pressed": "false", onclick: () => setDraft(false) }, "Saved");
  which.append(draftBtn, savedBtn);

  const preview = await a.mountPreview(frameBox, { draft: true, onLog: (l) => ws.log(l) });

  function layout() {
    const d = DEVICES.find((x) => x[0] === device);
    const size = d && d[2];
    if (!size) {
      frameBox.style.cssText = "";
      frameBox.classList.remove("device");
      return;
    }
    const avail = stage.clientWidth - 24;
    const availH = stage.clientHeight - 24;
    const scale = Math.min(1, avail / size[0], availH > 200 ? availH / size[1] : 1);
    frameBox.classList.add("device");
    frameBox.style.cssText = `width:${size[0]}px;height:${size[1]}px;transform:scale(${scale});margin-bottom:${-(size[1] * (1 - scale))}px;margin-right:${-(size[0] * (1 - scale))}px`;
  }
  new ResizeObserver(layout).observe(stage);
  deviceSel.onchange = () => {
    device = deviceSel.value;
    lsSet("studioDevice", device);
    layout();
  };

  async function setDraft(on) {
    showDraft = on;
    draftBtn.setAttribute("aria-pressed", String(on));
    savedBtn.setAttribute("aria-pressed", String(!on));
    await preview.reload(on);
  }

  const toolbar = h(
    "div",
    { class: "pv-toolbar" },
    deviceSel,
    which,
    h("button", { class: "btn btn-sm", type: "button", onclick: () => preview.reload(showDraft) }, "Reload"),
  );
  panel.replaceChildren(toolbar, stage);

  ws.onRefresh(async (what) => {
    if (what === "log") return;
    const has = await a.hasDraft();
    which.hidden = !has;
    if (!has) showDraft = false;
    await preview.reload(showDraft || has);
  });
  which.hidden = !(await a.hasDraft());

  ws.preview = {
    // Shows html (an app file, or a staged UI draft) and returns errors seen within `wait` ms.
    async check(html, wait = 2500) {
      const before = ws.logs.length;
      showDraft = true;
      draftBtn.setAttribute("aria-pressed", "true");
      savedBtn.setAttribute("aria-pressed", "false");
      which.hidden = false;
      if (preview.show) await preview.show(html);
      else await preview.reload(true);
      await new Promise((r) => setTimeout(r, wait));
      return [...new Set(ws.logs.slice(before).filter((l) => l.level === "error").map((l) => l.text))];
    },
  };
  layout();
}

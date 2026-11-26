import { h, toast, confirmDialog } from "../ui.js";
import { getDeviceIdentity, setDeviceLabel, getDeviceInfo, gpuLabel } from "../device.js";
import { deleteAllChats } from "../chats.js";
import { deleteAllSessions, APP_VERSION } from "../stats.js";
import { installHelp, isStandalone } from "../install.js";
import { autoDeleteSelect } from "./models-view.js";

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.dataset.theme = mode;
  else delete root.dataset.theme;
  const dark = mode === "dark" || (mode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute("content", dark ? "#0d0d0d" : "#f9f9f7");
}

export async function renderSettings(root, app) {
  root.innerHTML = "";
  const page = h("div", { class: "page", style: "max-width:720px" });
  root.append(page);
  page.append(h("h1", null, "Settings"));

  // Theme
  let theme = "system";
  try {
    theme = localStorage.getItem("theme") || "system";
  } catch {
    /* ignore */
  }
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Theme" });
  for (const [v, label] of [
    ["system", "System"],
    ["light", "Light"],
    ["dark", "Dark"],
  ]) {
    seg.append(
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(theme === v),
          onclick: () => {
            try {
              localStorage.setItem("theme", v);
            } catch {
              /* ignore */
            }
            applyTheme(v);
            for (const b of seg.children) b.setAttribute("aria-pressed", String(b === seg.children[["system", "light", "dark"].indexOf(v)]));
          },
        },
        label,
      ),
    );
  }
  page.append(h("h2", null, "Appearance"), h("div", { class: "card row" }, h("span", null, "Theme"), h("span", { class: "spacer" }), seg));

  // Device label
  const id = await getDeviceIdentity();
  const input = h("input", { class: "input", style: "flex:1;min-width:180px", value: id.label, "aria-label": "Device name" });
  page.append(
    h("h2", null, "This device"),
    h(
      "div",
      { class: "card" },
      h("p", { style: "margin:0 0 10px;color:var(--ink-2);font-size:14px" }, "Every stats record is tagged with this name. Give each phone, tablet or computer a clear name so you can compare them after importing stats in the dashboard."),
      h(
        "div",
        { class: "row" },
        input,
        h(
          "button",
          {
            class: "btn btn-primary",
            type: "button",
            onclick: async () => {
              const v = input.value.trim();
              if (!v) return;
              await setDeviceLabel(v);
              toast("Device name saved");
            },
          },
          "Save",
        ),
      ),
      h("div", { class: "mono muted", style: "margin-top:8px" }, "Device id " + id.id),
    ),
  );

  const info = await getDeviceInfo();
  page.append(
    h(
      "div",
      { class: "card", style: "margin-top:12px" },
      h(
        "dl",
        { class: "kv" },
        h("dt", null, "Browser"),
        h("dd", null, `${info.browser} ${info.browserVersion}`),
        h("dt", null, "OS"),
        h("dd", null, `${info.os} ${info.osVersion}`.trim()),
        info.deviceModel ? [h("dt", null, "Model"), h("dd", null, info.deviceModel)] : null,
        h("dt", null, "CPU cores"),
        h("dd", null, String(info.cores ?? "–")),
        h("dt", null, "Device memory"),
        h("dd", null, info.deviceMemoryGB ? `≥ ${info.deviceMemoryGB} GB (browser-rounded)` : "not exposed"),
        h("dt", null, "Screen"),
        h("dd", null, `${info.screen.w}×${info.screen.h} @${info.screen.dpr}x`),
        h("dt", null, "GPU"),
        h("dd", null, gpuLabel(info.gpu)),
        info.gpu.available ? [h("dt", null, "Max buffer"), h("dd", null, `${Math.round((info.gpu.limits.maxBufferSize || 0) / 1048576)} MB`)] : null,
        info.gpu.available ? [h("dt", null, "GPU features"), h("dd", { class: "mono" }, info.gpu.features.join(", "))] : null,
      ),
    ),
  );

  // Offline + install
  let swState = "not supported in this browser";
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    swState = reg && reg.active ? "ready: the app opens with no connection" : "not ready yet (reload once while online)";
  }
  const help = installHelp();
  page.append(
    h("h2", null, "Offline & install"),
    h(
      "div",
      { class: "card" },
      h(
        "dl",
        { class: "kv" },
        h("dt", null, "Offline app"),
        h("dd", null, swState),
        h("dt", null, "Installed"),
        h("dd", null, isStandalone() ? "yes, running as an app" : "no, running in the browser"),
        h("dt", null, "App version"),
        h("dd", null, APP_VERSION),
        h("dt", null, "WebLLM"),
        h("dd", null, app.catalog ? app.catalog.webllm : "–"),
      ),
      help ? h("div", { style: "margin-top:12px;font-size:14px;color:var(--ink-2)" }, help) : null,
      h("p", { style: "margin:10px 0 0;color:var(--ink-2);font-size:14px" }, "Downloaded models, chats and stats stay on this device and keep working without a connection."),
    ),
  );

  // Models
  page.append(
    h("h2", null, "Downloaded models"),
    h(
      "div",
      { class: "card" },
      h("div", { class: "row" }, h("label", { for: "auto-delete", style: "flex:1" }, "Auto-delete models that haven't been used"), autoDeleteSelect(app)),
      h("p", { style: "margin:10px 0 0;color:var(--ink-2);font-size:14px" }, "Checked when the app opens and every few hours. The model that's currently loaded is never deleted."),
    ),
  );

  // Data
  page.append(
    h("h2", null, "Data"),
    h(
      "div",
      { class: "card row" },
      h(
        "button",
        {
          class: "btn btn-danger",
          type: "button",
          onclick: async () => {
            if (!(await confirmDialog("Delete all chats?", "Every saved conversation in this browser is removed."))) return;
            await deleteAllChats();
            await app.renderChatList();
            toast("Chats deleted");
          },
        },
        "Delete all chats",
      ),
      h(
        "button",
        {
          class: "btn btn-danger",
          type: "button",
          onclick: async () => {
            if (!(await confirmDialog("Delete all stats?", "All recorded and imported sessions are removed. Export them first if you want a copy."))) return;
            const current = app.llm.session ? app.llm.session.id : null;
            await deleteAllSessions((s) => s.id !== current);
            toast("Stats deleted");
          },
        },
        "Delete all stats",
      ),
      h("a", { class: "btn", href: "#/models" }, "Manage saved models"),
    ),
  );
}

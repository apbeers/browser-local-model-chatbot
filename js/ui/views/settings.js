// Settings: appearance and themes, this device, offline/install, auto-delete
// for models and chats, and deleting data.
import { app } from "../../core/api.js";
import { h, toast, confirmDialog } from "../dom.js";
import { installHelp } from "../install-help.js";
import { autoDeleteSelect } from "./models.js";
import { openThemeMaker } from "./theme-maker.js";

const card = (...kids) => h("div", { class: "card" }, ...kids);
const note = (text) => h("p", { class: "note" }, text);

async function themeSection() {
  const mode = app.themes.getMode();
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Light or dark" });
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
          "aria-pressed": String(mode === v),
          onclick: () => {
            app.themes.setMode(v);
            [...seg.children].forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === label)));
          },
        },
        label,
      ),
    );
  }
  const settings = await app.settings.get();
  const themes = [app.themes.DEFAULT_THEME, ...(await app.themes.listThemes())];
  const list = h("div", { class: "theme-list" });
  const refresh = () => renderTheme().then((el) => wrap.replaceWith(el));
  for (const t of themes) {
    const active = (settings.themeId || "default") === t.id;
    const sw = (c) => h("i", { style: `background:${c}` });
    list.append(
      h(
        "div",
        { class: "theme-item" + (active ? " active" : "") },
        h("div", { class: "swatches", "aria-hidden": "true" }, sw(t.light.page), sw(t.light.accent), sw(t.dark.page), sw(t.dark.accent)),
        h("strong", null, t.name),
        active ? h("span", { class: "badge good" }, "In use") : h("button", { class: "btn btn-sm", type: "button", onclick: async () => (await app.themes.activateTheme(t.id), refresh()) }, "Use"),
        t.id !== "default" ? h("button", { class: "btn btn-sm", type: "button", onclick: () => openThemeMaker(t, refresh) }, "Edit") : null,
        t.id !== "default"
          ? h(
              "button",
              {
                class: "btn btn-sm btn-danger",
                type: "button",
                onclick: async () => {
                  if (!(await confirmDialog("Delete theme?", `“${t.name}” will be removed.`))) return;
                  await app.themes.deleteTheme(t.id);
                  refresh();
                },
              },
              "Delete",
            )
          : null,
      ),
    );
  }
  const wrap = card(
    h("div", { class: "row" }, h("span", null, "Light or dark"), h("span", { class: "spacer" }), seg),
    h("h3", { class: "card-title" }, "Color themes"),
    list,
    h(
      "div",
      { class: "row", style: "margin-top:12px" },
      h("button", { class: "btn btn-primary", type: "button", onclick: () => openThemeMaker(null, refresh) }, "Create a theme"),
    ),
    note("Describe a theme and the on-device coding model designs it, or pick the colors yourself. Themes work with every UI."),
  );
  return wrap;
}
const renderTheme = themeSection;

export async function render(root) {
  const page = h("div", { class: "page", style: "max-width:760px" }, h("h1", null, "Settings"));
  root.replaceChildren(page);

  page.append(h("h2", null, "Appearance"), await themeSection());

  // This device
  const id = await app.device.getDeviceIdentity();
  const input = h("input", { class: "input", style: "flex:1;min-width:180px", value: id.label, "aria-label": "Device name" });
  const info = await app.device.getDeviceInfo();
  page.append(
    h("h2", null, "This device"),
    card(
      note("Every stats record is tagged with this name. Name each phone, tablet or computer so you can tell them apart after importing stats."),
      h(
        "div",
        { class: "row" },
        input,
        h("button", { class: "btn btn-primary", type: "button", onclick: async () => input.value.trim() && (await app.device.setDeviceLabel(input.value.trim()), toast("Device name saved")) }, "Save"),
      ),
      h(
        "dl",
        { class: "kv", style: "margin-top:14px" },
        h("dt", null, "Browser"),
        h("dd", null, `${info.browser} ${info.browserVersion}`),
        h("dt", null, "OS"),
        h("dd", null, `${info.os} ${info.osVersion}`.trim()),
        h("dt", null, "CPU cores"),
        h("dd", null, String(info.cores ?? "–")),
        h("dt", null, "Memory"),
        h("dd", null, info.deviceMemoryGB ? `≥ ${info.deviceMemoryGB} GB (rounded by the browser)` : "not shared by the browser"),
        h("dt", null, "GPU"),
        h("dd", null, app.device.gpuLabel(info.gpu) + (info.gpu.available ? (info.gpu.shaderF16 ? " · f16" : " · f32 only") : "")),
      ),
    ),
  );

  // Offline & install
  let sw = "not supported in this browser";
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    sw = reg && reg.active ? "ready: the app opens with no connection" : "not ready yet (reload once while online)";
  }
  const help = installHelp();
  page.append(
    h("h2", null, "Offline & install"),
    card(
      h(
        "dl",
        { class: "kv" },
        h("dt", null, "Offline app"),
        h("dd", null, sw),
        h("dt", null, "Installed"),
        h("dd", null, app.install.isStandalone() ? "yes, running as an app" : "no, running in the browser"),
        h("dt", null, "Version"),
        h("dd", null, `${app.appVersion} · API ${app.apiVersion} · WebLLM ${app.catalog ? app.catalog.webllm : "–"}`),
      ),
      help ? h("div", { class: "note" }, help) : null,
      note("Chats, projects, stats, themes, custom UIs and downloaded models are stored on this device only."),
    ),
  );

  // Auto-delete
  const s = await app.settings.get();
  const chatSel = h("select", { class: "select", id: "chat-auto-delete" });
  for (const [v, label] of app.settings.AUTO_DELETE_OPTIONS) chatSel.append(h("option", { value: String(v), selected: s.chatAutoDeleteDays === v ? true : null }, label.replace("unused", "not opened")));
  chatSel.onchange = async () => {
    await app.settings.set("chatAutoDeleteDays", Number(chatSel.value));
    toast(Number(chatSel.value) ? `Chats not opened for ${chatSel.value} days will be deleted` : "Chats are kept forever");
    await app.runAutoDelete();
  };
  page.append(
    h("h2", null, "Auto-delete"),
    card(
      h("div", { class: "row" }, h("label", { for: "auto-delete", class: "spacer" }, "Downloaded models"), autoDeleteSelect()),
      h("div", { class: "row", style: "margin-top:10px" }, h("label", { for: "chat-auto-delete", class: "spacer" }, "Chats"), chatSel),
      note("Off by default. Checked when the app opens and every few hours. The loaded model and the open chat are never deleted. Projects can override the chat setting."),
    ),
  );

  // Data
  page.append(
    h("h2", null, "Delete data"),
    card(
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            class: "btn btn-danger",
            type: "button",
            onclick: async () => {
              if (!(await confirmDialog("Delete all chats?", "Every chat on this device is removed. Projects are kept, empty."))) return;
              await app.chats.deleteAllChats();
              app.emit("chats-changed");
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
              await app.stats.deleteAllSessions((x) => x.id !== current);
              toast("Stats deleted");
            },
          },
          "Delete all stats",
        ),
        h("a", { class: "btn", href: "#/models" }, "Manage downloaded models"),
      ),
    ),
  );
}

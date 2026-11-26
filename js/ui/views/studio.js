// Studio home (#/studio): build apps with the on-device agent, start from
// templates, and manage custom versions of this chatbot's UI.
// #/studio/app/<id> and #/studio/ui/<id> open the workspace (studio/workspace.js).
import { app } from "../../core/api.js";
import { h, toast, confirmDialog, promptDialog, relTime, modal } from "../dom.js";
import { workspace } from "../studio/workspace.js";
import { appAdapter, uiAdapter } from "../studio/adapters.js";
import { pinApp } from "../studio/pin.js";

const V = () => app.variants;
const pendingRequest = new Map(); // app id -> first request to send when the workspace opens

async function activateUI(id) {
  await V().setActive(id);
  toast(id === "default" ? "Switching to the default UI…" : "Switching UI…");
  setTimeout(() => {
    const target = new URL("./#/studio", location.href);
    if (target.pathname + target.search === location.pathname + location.search) {
      location.hash = "#/studio";
      location.reload();
    } else location.href = target.href;
  }, 400);
}

function previewUI(id, name) {
  const frame = h("iframe", { src: `./?ui=${encodeURIComponent(id)}#/chat`, class: "preview-frame", title: `Preview of ${name}` });
  modal(`Preview: ${name}`, h("div", null, h("p", { class: "note" }, "The real app running this UI, with your real chats. ", h("a", { href: `./?ui=${encodeURIComponent(id)}`, target: "_blank" }, "Open in a new tab")), frame));
}

export async function render(root, [kind, id] = []) {
  root.classList.toggle("view-flush", !!kind);
  if (kind === "app" || kind === "ui") {
    const adapter = kind === "app" ? await appAdapter(id) : await uiAdapter(id);
    if (!adapter) {
      toast("Not found");
      location.hash = "#/studio";
      return;
    }
    const req = pendingRequest.get(id);
    pendingRequest.delete(id);
    await workspace(root, adapter, { initialRequest: req });
    return;
  }
  await home(root);
}

async function newApp({ request, template }) {
  let html = "";
  let name = "New app";
  let emoji = "✨";
  if (template) {
    html = await app.builder.loadDoc("templates/" + template.file);
    name = template.name;
    emoji = { blank: "📄", list: "✅", calculator: "🧮", notes: "📝", tracker: "📈", ai: "🤖", game: "🎮" }[template.id] || "✨";
  }
  const a = await app.apps.createApp({ name, emoji, html, template: template ? template.id : "agent", description: request || "" });
  if (request) pendingRequest.set(a.id, request);
  app.emit("usage", { event: "studio-new-app", from: template ? "template" : "prompt" });
  location.hash = `#/studio/app/${a.id}`;
}

async function home(root) {
  const page = h("div", { class: "page" });
  root.replaceChildren(page);
  const rerender = () => home(root);
  const ask = h("textarea", { class: "input", rows: 3, style: "width:100%;resize:vertical", placeholder: "e.g. a packing list for trips with categories, or a flashcard quiz that uses AI to make questions" });
  page.append(
    h("h1", null, "Studio"),
    h("p", { class: "lede" }, "Build small apps and tools on this device with a local coding agent, or customize this chatbot. Everything works offline and stays on this device."),
    h(
      "form",
      {
        class: "card studio-ask",
        onsubmit: (e) => {
          e.preventDefault();
          if (ask.value.trim()) newApp({ request: ask.value.trim() });
        },
      },
      h("h3", { class: "card-title" }, "What do you want to build?"),
      ask,
      h("div", { class: "row", style: "margin-top:10px" }, h("button", { class: "btn btn-primary" }, "Build it"), h("span", { class: "note" }, "The agent plans it, writes a draft and tests it. You keep it or throw it away.")),
    ),
  );

  // Templates
  const { templates } = JSON.parse(await app.builder.loadDoc("templates/index.json"));
  page.append(
    h("h2", null, "Start from a template"),
    h(
      "div",
      { class: "tpl-grid" },
      templates.map((t) => h("button", { type: "button", class: "tpl", onclick: () => newApp({ template: t }) }, h("strong", null, t.name), h("span", null, t.description))),
    ),
  );

  // Apps
  const apps = await app.apps.listApps();
  page.append(h("h2", null, `Your apps (${apps.length})`));
  if (!apps.length) page.append(h("p", { class: "note" }, "No apps yet."));
  page.append(
    h(
      "div",
      { class: "app-grid" },
      apps.map((a) =>
        h(
          "div",
          { class: "app-card" },
          h("a", { class: "app-icon", href: `#/run/${a.id}`, style: `background:${a.color}`, "aria-label": `Open ${a.name}` }, a.emoji || "✨"),
          h("div", { class: "app-meta" }, h("strong", null, a.name), h("span", { class: "note" }, `Changed ${relTime(a.updatedAt)}`)),
          h(
            "div",
            { class: "row" },
            h("a", { class: "btn btn-sm btn-primary", href: `#/run/${a.id}` }, "Open"),
            h("a", { class: "btn btn-sm", href: `#/studio/app/${a.id}` }, "Edit"),
            h("button", { class: "btn btn-sm", type: "button", onclick: () => pinApp(a.id) }, "Pin"),
            h(
              "button",
              {
                class: "btn btn-sm",
                type: "button",
                onclick: async () => {
                  const name = await promptDialog("Rename app", a.name);
                  if (name) await app.apps.updateApp(a.id, { name });
                  rerender();
                },
              },
              "Rename",
            ),
            h(
              "button",
              {
                class: "btn btn-sm btn-danger",
                type: "button",
                onclick: async () => {
                  if (!(await confirmDialog(`Delete ${a.name}?`, "The app, its history and the data it saved are removed from this device."))) return;
                  await app.apps.deleteApp(a.id);
                  rerender();
                },
              },
              "Delete",
            ),
          ),
        ),
      ),
    ),
  );

  // Chatbot UIs
  page.append(h("h2", null, "Customize this chatbot"));
  if (!V().supported()) {
    page.append(h("div", { class: "card" }, "Custom chatbot UIs need the offline app (service worker), which isn't running yet. Reload once while online."));
    return;
  }
  const [list, active] = await Promise.all([V().listVariants(), V().getActive()]);
  const row = (v) => {
    const isDefault = !v;
    const vid = isDefault ? "default" : v.id;
    const outdated = !isDefault && v.apiVersion !== app.apiVersion;
    return h(
      "div",
      { class: "card model-card" },
      h(
        "div",
        null,
        h("h3", null, isDefault ? "Default UI" : v.name),
        h("div", { class: "facts" }, h("span", null, isDefault ? "The version from the website. Read-only." : `Changed ${relTime(v.updatedAt)}`)),
        h("div", { class: "row", style: "gap:6px;margin-top:6px" }, vid === active ? h("span", { class: "badge good" }, "In use") : null, outdated ? h("span", { class: "badge bad" }, "Made for an older app version") : null),
      ),
      h(
        "div",
        { class: "actions" },
        isDefault
          ? h(
              "button",
              {
                class: "btn btn-primary",
                type: "button",
                onclick: async () => {
                  const name = await promptDialog("Name your UI", "My UI");
                  if (!name) return;
                  const nv = await V().createVariant(name);
                  location.hash = `#/studio/ui/${nv.id}`;
                },
              },
              "Copy to customize",
            )
          : h("a", { class: "btn btn-primary", href: `#/studio/ui/${v.id}` }, "Edit"),
        !isDefault ? h("button", { class: "btn", type: "button", onclick: () => previewUI(v.id, v.name) }, "Preview") : null,
        vid !== active ? h("button", { class: "btn", type: "button", onclick: () => activateUI(vid) }, "Use this UI") : null,
        !isDefault
          ? h(
              "button",
              {
                class: "btn btn-danger",
                type: "button",
                onclick: async () => {
                  if (!(await confirmDialog("Delete UI?", `“${v.name}” and its history are removed. Chats and stats are kept.`))) return;
                  await V().deleteVariant(v.id);
                  if (vid === active) return activateUI("default");
                  rerender();
                },
              },
              "Delete",
            )
          : null,
      ),
    );
  };
  page.append(h("div", { class: "cards" }, row(null), ...list.map(row)));
  page.append(
    h(
      "p",
      { class: "note" },
      "If a UI breaks the app: add ?safe to the address for the default UI, or open ",
      h("a", { href: "recover.html" }, "the recovery page"),
      ". A UI that fails to start is switched back to the default on the next launch.",
    ),
  );
}

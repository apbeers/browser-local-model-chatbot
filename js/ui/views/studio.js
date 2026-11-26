// Studio: create custom versions of this app's UI, edit them with the
// on-device coding model (or by hand) in studio-editor.js, preview them, and
// switch which UI the app uses. The default UI can't be changed, only copied.
import { app } from "../../core/api.js";
import { h, toast, confirmDialog, promptDialog, relTime, modal } from "../dom.js";
import { renderEditor } from "./studio-editor.js";

const V = () => app.variants;
let openId = null; // custom UI being edited

export function previewUI(id, name) {
  const frame = h("iframe", { src: `./?ui=${encodeURIComponent(id)}#/chat`, class: "preview-frame", title: `Preview of ${name}` });
  modal(`Preview: ${name}`, h("div", null, h("p", { class: "note" }, "This is the real app running your custom UI. It uses your real chats and settings. ", h("a", { href: `./?ui=${encodeURIComponent(id)}`, target: "_blank" }, "Open in a new tab")), frame));
}

async function activate(id) {
  await V().setActive(id);
  toast(id === "default" ? "Switching to the default UI…" : "Switching UI…");
  setTimeout(() => {
    // A real page load is needed so every file comes from the newly chosen UI.
    const target = new URL("./#/studio", location.href);
    if (target.pathname + target.search === location.pathname + location.search) {
      location.hash = "#/studio";
      location.reload();
    } else location.href = target.href;
  }, 400);
}

export async function render(root) {
  const page = h("div", { class: "page" });
  root.replaceChildren(page);
  const rerender = () => render(root);
  page.append(
    h("h1", null, "Studio"),
    h(
      "p",
      { class: "lede" },
      "Build your own version of this app. Copy the default UI, then change its styles or any screen with the on-device coding model or by hand. Your UIs live only on this device; the default UI from the website never changes.",
    ),
  );
  if (!V().supported()) {
    page.append(h("div", { class: "card" }, "Custom UIs need the offline app (service worker), which isn't running yet. Reload the page once while online, then come back."));
    return;
  }
  if (openId) {
    const v = await V().getVariant(openId);
    if (v) {
      page.replaceChildren();
      await renderEditor(page, v, {
        onBack: () => {
          openId = null;
          rerender();
        },
        onActivate: () => activate(v.id),
        onPreview: () => previewUI(v.id, v.name),
      });
      return;
    }
    openId = null;
  }

  const [list, active] = await Promise.all([V().listVariants(), V().getActive()]);
  const effective = window.__safe ? "default" : window.__previewUI || active;
  const rows = h("div", { class: "cards" });
  const item = (v, isDefault) => {
    const isActive = (isDefault ? "default" : v.id) === active;
    const outdated = !isDefault && v.apiVersion !== app.apiVersion;
    return h(
      "div",
      { class: "card model-card" },
      h(
        "div",
        null,
        h("h3", null, isDefault ? "Default UI" : v.name),
        h("div", { class: "facts" }, isDefault ? h("span", null, "The version from the website. Read-only.") : h("span", null, `Changed ${relTime(v.updatedAt)}`)),
        h(
          "div",
          { class: "row", style: "gap:6px;margin-top:6px" },
          isActive ? h("span", { class: "badge good" }, "Active") : null,
          (isDefault ? "default" : v.id) === effective && !isActive ? h("span", { class: "badge" }, "Showing now") : null,
          outdated ? h("span", { class: "badge bad" }, "Built for an older app version; check it still works") : null,
        ),
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
                  openId = nv.id;
                  rerender();
                },
              },
              "Copy to customize",
            )
          : h(
              "button",
              {
                class: "btn btn-primary",
                type: "button",
                onclick: () => {
                  openId = v.id;
                  rerender();
                },
              },
              "Edit",
            ),
        !isDefault ? h("button", { class: "btn", type: "button", onclick: () => previewUI(v.id, v.name) }, "Preview") : null,
        !isActive ? h("button", { class: "btn", type: "button", onclick: () => activate(isDefault ? "default" : v.id) }, "Use this UI") : null,
        !isDefault
          ? h(
              "button",
              {
                class: "btn",
                type: "button",
                onclick: async () => {
                  const name = await promptDialog("Duplicate UI", `${v.name} copy`);
                  if (!name) return;
                  await V().createVariant(name, { copyFrom: v.id });
                  rerender();
                },
              },
              "Duplicate",
            )
          : null,
        !isDefault
          ? h(
              "button",
              {
                class: "btn",
                type: "button",
                onclick: async () => {
                  const name = await promptDialog("Rename UI", v.name);
                  if (name) await V().renameVariant(v.id, name);
                  rerender();
                },
              },
              "Rename",
            )
          : null,
        !isDefault
          ? h(
              "button",
              {
                class: "btn btn-danger",
                type: "button",
                onclick: async () => {
                  if (!(await confirmDialog("Delete UI?", `“${v.name}” and its history are removed. Chats and stats are not affected.`))) return;
                  await V().deleteVariant(v.id);
                  if (isActive) return activate("default");
                  rerender();
                },
              },
              "Delete",
            )
          : null,
      ),
    );
  };
  rows.append(item(null, true), ...list.map((v) => item(v, false)));
  page.append(rows);
  page.append(
    h(
      "div",
      { class: "card", style: "margin-top:16px" },
      h("h3", { class: "card-title" }, "If a UI breaks the app"),
      h("p", { class: "note" }, "Open the app with ?safe at the end of the address to get the default UI for that visit, or use the recovery page. If a custom UI fails to start, the app switches back to the default automatically on the next launch."),
      h("div", { class: "row" }, h("a", { class: "btn", href: "./?safe" }, "Open in safe mode"), h("a", { class: "btn", href: "recover.html" }, "Recovery page")),
    ),
  );
}

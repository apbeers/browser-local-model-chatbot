// Runs a Studio app full screen: #/run/<appId>.
import { app } from "../../core/api.js";
import { h, toast } from "../dom.js";

let current = null; // mounted app, destroyed when leaving

export async function render(root, [appId]) {
  if (current) current.destroy();
  current = null;
  const info = appId && (await app.apps.getApp(appId));
  if (!info) {
    root.replaceChildren(h("div", { class: "page" }, h("h1", null, "App not found"), h("a", { class: "btn", href: "#/studio" }, "Back to Studio")));
    return;
  }
  const frameBox = h("div", { class: "run-frame" });
  root.replaceChildren(
    h(
      "div",
      { class: "run-bar" },
      h("a", { class: "btn btn-sm", href: "#/studio" }, "← Studio"),
      h("strong", { class: "run-title" }, `${info.emoji || ""} ${info.name}`),
      h("a", { class: "btn btn-sm", href: `#/studio/app/${info.id}` }, "Edit"),
      h("button", { class: "btn btn-sm", type: "button", onclick: () => import("../studio/pin.js").then((m) => m.pinApp(info.id)) }, "Pin"),
    ),
    frameBox,
  );
  current = app.apps.mount(frameBox, { appId: info.id, html: await app.apps.readApp(info.id), onNotify: (t) => toast(t) });
  app.emit("usage", { event: "app-run", appId: info.id });
  // Unmount when the user leaves this page.
  const off = () => {
    if (!location.hash.startsWith("#/run/" + info.id) && current) {
      current.destroy();
      current = null;
      window.removeEventListener("hashchange", off);
    }
  };
  window.addEventListener("hashchange", off);
}

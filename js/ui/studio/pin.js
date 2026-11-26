// "Pin to Home Screen" for Studio apps: prepares the pin (manifest + icons +
// packed copy of the app) and explains how to install it on this device.
import { app } from "../../core/api.js";
import { h, modal, toast } from "../dom.js";

export async function pinApp(id) {
  const info = await app.apps.getApp(id);
  if (!info) return;
  if (!("caches" in window) || !navigator.serviceWorker || !navigator.serviceWorker.controller) {
    toast("Pinning needs the offline app. Reload once while online, then try again.", 5000);
    return;
  }
  const html = await app.apps.readApp(id);
  if (!html.trim()) return toast("Build the app first: it's empty.");
  const url = await app.pins.createPin(info, html);
  app.emit("usage", { event: "app-pin", appId: id });
  const p = app.install.platform();
  const steps = {
    iphone: "In the page that opens, tap Share, then “Add to Home Screen”. Open it once while online to finish setting it up.",
    ipad: "In the page that opens, tap Share, then “Add to Home Screen”. Open it once while online to finish setting it up.",
    android: "In the page that opens, tap Install (or the browser menu ⋮ → Install app / Add to Home screen).",
    "mac-safari": "In the page that opens, choose File → Add to Dock.",
    desktop: "In the page that opens, click Install (or the install icon in the address bar).",
  }[p];
  const dlg = modal(
    `Pin “${info.name}”`,
    h(
      "div",
      null,
      h("div", { class: "row", style: "margin-bottom:12px" }, h("span", { class: "app-icon", style: `background:${info.color}` }, info.emoji || "✨"), h("strong", null, info.name)),
      h("p", null, "It installs as its own app with its own icon and works offline. ", steps),
      h(
        "p",
        { class: "note" },
        ["iphone", "ipad"].includes(p)
          ? "On iPhone and iPad, Home Screen apps keep separate storage: the pinned app gets a copy of this version, its own saved data, and downloads a model again if it uses AI. Pin again after big changes."
          : "The pinned app always runs the latest saved version and shares models with this app.",
      ),
      h(
        "div",
        { class: "row", style: "justify-content:flex-end" },
        h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: async () => {
              await app.pins.removePin(id);
              toast("Pin removed. Remove the icon from your Home Screen too.");
              dlg.close();
            },
          },
          "Remove pin",
        ),
        h("a", { class: "btn btn-primary", href: url, target: "_blank", rel: "noopener", onclick: () => setTimeout(() => dlg.close(), 300) }, "Open to install"),
      ),
    ),
  );
}

// "How to install" text for this device, or an Install button where the
// browser supports it. Returns null when the app is already installed.
import { app } from "../core/api.js";
import { h } from "./dom.js";

const SHARE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px;vertical-align:-3px"><path d="M12 15V3M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>';

export function installHelp() {
  const i = app.install;
  if (i.isStandalone()) return null;
  if (i.canPrompt()) {
    return h(
      "div",
      { class: "row" },
      h("span", null, "Install the app to use it offline from your Home Screen."),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => i.promptInstall() }, "Install app"),
    );
  }
  const p = i.platform();
  if (p === "iphone" || p === "ipad") {
    return h("span", {
      html: `In Safari, tap Share ${SHARE_ICON} then <strong>Add to Home Screen</strong>. The app opens full screen and works offline. Models downloaded in Safari may need downloading again inside the Home Screen app.`,
    });
  }
  if (p === "mac-safari") return h("span", { html: "In Safari, choose File → <strong>Add to Dock</strong> to install it as an app that works offline." });
  if (p === "android") return h("span", { html: "Open the browser menu (⋮) and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>." });
  return h("span", { html: "Use the install icon in the address bar, or the browser menu → <strong>Install app</strong>." });
}

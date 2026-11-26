// "Add to Home Screen" / install support.
// Chrome, Edge and Android fire beforeinstallprompt, so we can show our own
// Install button. Safari (iPhone, iPad, Mac) has no prompt API, so we show
// the Share → Add to Home Screen steps instead.
import { h, toast } from "./ui.js";

let deferred = null;
const listeners = new Set();

export function initInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    toast("Installed. Open it from your Home Screen or app list.");
    listeners.forEach((fn) => fn());
  });
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return "iphone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ipad";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return "mac-safari";
  return "desktop";
}

export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((fn) => fn());
  return outcome === "accepted";
}

const SHARE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px;vertical-align:-3px"><path d="M12 15V3M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>';

// Returns an element explaining how to install on this device, or null when
// already installed.
export function installHelp() {
  if (isStandalone()) return null;
  const p = platform();
  if (deferred) {
    return h(
      "div",
      { class: "row" },
      h("span", null, "Install the app to use it offline from your Home Screen."),
      h(
        "button",
        {
          class: "btn btn-primary",
          type: "button",
          onclick: async () => {
            await promptInstall();
          },
        },
        "Install app",
      ),
    );
  }
  if (p === "iphone" || p === "ipad") {
    return h("span", {
      html: `In Safari, tap Share ${SHARE_ICON} then <strong>Add to Home Screen</strong>. The app opens full screen and works offline. Models you've downloaded in Safari may need downloading again inside the Home Screen app.`,
    });
  }
  if (p === "mac-safari") return h("span", { html: "In Safari, choose File → <strong>Add to Dock</strong> to install it as an app that works offline." });
  if (p === "android") return h("span", { html: "Open the browser menu (⋮) and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>." });
  return h("span", { html: "Use the install icon in the address bar, or the browser menu → <strong>Install app</strong>." });
}

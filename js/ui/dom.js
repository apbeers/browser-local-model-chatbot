// Tiny DOM + formatting helpers shared by all views.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) {
    if (c == null) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const icons = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V9M7 14l5-5 5 5M5 4h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2zM12 10v4M12 17.5v.5"/></svg>',
};

export function iconBtn(name, label, onclick, cls = "icon-btn sm") {
  return h("button", { type: "button", class: cls, "aria-label": label, title: label, html: icons[name], onclick });
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function confirmDialog(title, body, okLabel = "Delete", danger = true) {
  return new Promise((resolve) => {
    const dlg = h(
      "dialog",
      { style: "width:min(420px, calc(100vw - 24px))" },
      h("div", { class: "dialog-head" }, h("h2", null, title)),
      h(
        "div",
        { class: "dialog-body" },
        h("p", { style: "margin-top:0;color:var(--ink-2)" }, body),
        h(
          "div",
          { class: "row", style: "justify-content:flex-end" },
          h("button", { class: "btn", type: "button", onclick: () => dlg.close("cancel") }, "Cancel"),
          h("button", { class: "btn " + (danger ? "btn-danger" : "btn-primary"), type: "button", onclick: () => dlg.close("ok") }, okLabel),
        ),
      ),
    );
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue === "ok");
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function promptDialog(title, value) {
  return new Promise((resolve) => {
    const input = h("input", { class: "input", style: "width:100%", value: value || "" });
    const form = h(
      "form",
      { method: "dialog", class: "dialog-body" },
      input,
      h(
        "div",
        { class: "row", style: "justify-content:flex-end;margin-top:14px" },
        h("button", { class: "btn", type: "button", onclick: () => dlg.close("cancel") }, "Cancel"),
        h("button", { class: "btn btn-primary", value: "ok" }, "Save"),
      ),
    );
    const dlg = h("dialog", { style: "width:min(420px, calc(100vw - 24px))" }, h("div", { class: "dialog-head" }, h("h2", null, title)), form);
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue === "ok" ? input.value.trim() : null);
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
    input.select();
  });
}

export function modal(title, content) {
  const dlg = h(
    "dialog",
    null,
    h("div", { class: "dialog-head" }, h("h2", null, title), iconBtn("x", "Close", () => dlg.close(), "icon-btn")),
    h("div", { class: "dialog-body" }, content),
  );
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

// ---------- formatting ----------
export function fmtNum(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "–";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return Math.round(ms) + " ms";
  if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + " s";
  const m = Math.floor(ms / 60000);
  return `${m}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function fmtDate(t) {
  if (!t) return "–";
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relTime(t) {
  const d = Date.now() - t;
  if (d < 60000) return "just now";
  if (d < 3600000) return Math.floor(d / 60000) + "m ago";
  if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
  if (d < 7 * 86400000) return Math.floor(d / 86400000) + "d ago";
  return new Date(t).toLocaleDateString();
}

export function downloadFile(name, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept = "application/json,.json") {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept, multiple: true, style: "display:none" });
    input.addEventListener("change", () => {
      resolve([...input.files]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

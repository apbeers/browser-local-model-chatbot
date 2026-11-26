// Storage manager: every file this app keeps in the browser, what it is and
// where it came from. Open folders, view files, delete what you don't need.
// The website's own files are listed read-only.
import { app } from "../../core/api.js";
import { h, toast, confirmDialog, modal } from "../dom.js";

const S = () => app.storage;
const fmt = (n) => app.models.fmtBytes(n);

function viewer(title, content) {
  modal(title, content);
}

async function showFile(path) {
  const r = await S().readForView(path);
  const src = await S().modelFileSource(path);
  viewer(
    path.split("/").pop(),
    h(
      "div",
      null,
      h("p", { class: "note mono" }, path),
      src ? h("p", { class: "note" }, "Downloaded from: ", h("span", { class: "mono" }, src)) : null,
      r.binary
        ? h("p", null, `Binary file, ${fmt(r.size)}. First bytes: `, h("span", { class: "mono" }, r.head))
        : h("pre", { class: "storage-view" }, r.text + (r.truncated ? `\n\n… (showing the first part of ${fmt(r.size)})` : "")),
    ),
  );
}

// One OPFS entry (file or folder). Folders load their contents when opened.
function entry(e, onDeleted) {
  const del = h(
    "button",
    {
      class: "btn btn-sm btn-danger",
      type: "button",
      onclick: async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const what = e.label ? `${e.label} (${e.path})` : e.path;
        if (!(await confirmDialog(`Delete ${e.kind === "directory" ? "folder" : "file"}?`, `${what} will be removed from this device.${e.path.startsWith("tvmjs") ? " Models removed here download again next time they're used." : ""}`))) return;
        await S().removePath(e.path);
        toast("Deleted");
        if (e.path.startsWith("tvmjs") || e.path === "") await app.refreshModels();
        if (e.path.startsWith("app/chats")) app.emit("chats-changed");
        onDeleted();
      },
    },
    "Delete",
  );
  const meta = h("span", { class: "st-meta" }, e.kind === "file" ? fmt(e.size) : "");
  const label = h("span", { class: "st-name" }, h("span", { class: "mono" }, e.name), e.label && e.top ? h("strong", null, e.label) : null, e.source && e.top ? h("small", null, e.source) : null);
  if (e.kind === "file") {
    return h("div", { class: "st-row" }, label, meta, h("button", { class: "btn btn-sm", type: "button", onclick: () => showFile(e.path) }, "View"), del);
  }
  const body = h("div", { class: "st-children" });
  const d = h("details", { class: "st-dir" }, h("summary", { class: "st-row" }, label, meta, del), body);
  let loaded = false;
  const load = async () => {
    const kids = await S().listDir(e.path);
    body.replaceChildren(...(kids.length ? kids.slice(0, 400).map((k) => entry(k, load)) : [h("div", { class: "note" }, "Empty")]));
    if (kids.length > 400) body.append(h("div", { class: "note" }, `…and ${kids.length - 400} more`));
  };
  d.addEventListener("toggle", () => {
    if (d.open && !loaded) {
      loaded = true;
      load();
    }
  });
  S()
    .dirSize(e.path)
    .then((s) => (meta.textContent = `${fmt(s.bytes)} · ${s.files} file${s.files === 1 ? "" : "s"}`))
    .catch(() => {});
  return d;
}

function cacheSection(c, onChange) {
  const body = h("div", { class: "st-children" });
  const d = h(
    "details",
    { class: "st-dir" },
    h(
      "summary",
      { class: "st-row" },
      h("span", { class: "st-name" }, h("span", { class: "mono" }, c.name), h("strong", null, c.label), h("small", null, c.source)),
      h("span", { class: "st-meta" }, `${c.entries} item${c.entries === 1 ? "" : "s"}`),
      c.readOnly
        ? h("span", { class: "badge" }, "read-only")
        : h(
            "button",
            {
              class: "btn btn-sm btn-danger",
              type: "button",
              onclick: async (ev) => {
                ev.preventDefault();
                if (!(await confirmDialog("Delete this cache?", `${c.label} (${c.name}) will be removed.`))) return;
                await S().deleteCache(c.name);
                onChange();
              },
            },
            "Delete",
          ),
    ),
    body,
  );
  d.addEventListener("toggle", async () => {
    if (!d.open || body.childElementCount) return;
    const scope = new URL("./", location.href).href;
    const items = await S().listCacheEntries(c.name);
    body.replaceChildren(
      ...items.map((it) =>
        h(
          "div",
          { class: "st-row" },
          h("span", { class: "st-name mono" }, it.url.replace(scope, "")),
          h("span", { class: "st-meta" }, fmt(it.size)),
          h(
            "button",
            {
              class: "btn btn-sm",
              type: "button",
              onclick: async () => {
                const r = await S().readCacheEntry(c.name, it.url);
                viewer(it.url.replace(scope, ""), r && !r.binary ? h("pre", { class: "storage-view" }, r.text + (r.truncated ? "\n…" : "")) : h("p", null, `Binary (${r ? r.type : "unknown"}), ${fmt(r ? r.size : 0)}`));
              },
            },
            "View",
          ),
          c.readOnly
            ? null
            : h(
                "button",
                {
                  class: "btn btn-sm btn-danger",
                  type: "button",
                  onclick: async () => {
                    await S().deleteCacheEntry(c.name, it.url);
                    onChange();
                  },
                },
                "Delete",
              ),
        ),
      ),
    );
  });
  return d;
}

export async function render(root) {
  const page = h("div", { class: "page" });
  root.replaceChildren(page);
  const rerender = () => render(root);
  let est = null;
  let persisted = null;
  try {
    est = await navigator.storage.estimate();
    persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
  } catch {
    /* ignore */
  }
  page.append(
    h("h1", null, "Storage"),
    h("p", { class: "lede" }, "Everything this app keeps in your browser. Nothing here is uploaded anywhere. Open a folder to see its files; view or delete anything you created."),
    h(
      "div",
      { class: "card" },
      h(
        "dl",
        { class: "kv" },
        h("dt", null, "Used"),
        h("dd", null, est ? `${fmt(est.usage)} of ${fmt(est.quota)} available to this site` : "unknown"),
        h("dt", null, "Persistent"),
        h("dd", null, persisted == null ? "unknown" : persisted ? "yes: the browser won't clear it on its own" : "no: the browser may clear it when space runs low"),
      ),
      persisted === false && navigator.storage.persist
        ? h("button", { class: "btn", type: "button", style: "margin-top:10px", onclick: async () => (toast((await navigator.storage.persist()) ? "Granted" : "Declined (installing the app usually helps)"), rerender()) }, "Ask to keep it permanently")
        : null,
    ),
  );

  if (app.opfsAvailable()) {
    const top = await S().listDir("");
    const flat = [];
    for (const e of top) {
      // Show app/* children at the top level: "app" itself means nothing to people.
      if (e.path === "app" && e.kind === "directory") flat.push(...(await S().listDir("app")));
      else flat.push(e);
    }
    page.append(h("h2", null, "Your data on this device"), h("div", { class: "st-tree" }, flat.length ? flat.map((e) => entry(e, rerender)) : h("p", { class: "note" }, "Nothing saved yet.")));
  }

  if ("caches" in window) {
    const list = await S().listCaches();
    const shell = list.filter((c) => c.readOnly);
    page.append(h("h2", null, "Offline copies"), h("div", { class: "st-tree" }, list.filter((c) => !c.readOnly).map((c) => cacheSection(c, rerender))));
    if (!list.some((c) => !c.readOnly)) page.append(h("p", { class: "note" }, "None."));
    page.append(
      h("h2", null, "Website files (read-only)"),
      h("p", { class: "note" }, "The app itself: code, styles, icons and the docs the coding model reads. They come from this website and update automatically, so they can't be deleted here."),
      h("div", { class: "st-tree" }, shell.map((c) => cacheSection(c, rerender))),
    );
  }

  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  } catch {
    /* unavailable */
  }
  page.append(
    h("h2", null, "Small preferences (localStorage)"),
    h(
      "div",
      { class: "st-tree" },
      keys.sort().map((k) =>
        h(
          "div",
          { class: "st-row" },
          h("span", { class: "st-name" }, h("span", { class: "mono" }, k), h("small", { class: "mono" }, String(localStorage.getItem(k)).slice(0, 80))),
          h(
            "button",
            {
              class: "btn btn-sm btn-danger",
              type: "button",
              onclick: () => {
                localStorage.removeItem(k);
                rerender();
              },
            },
            "Delete",
          ),
        ),
      ),
    ),
  );
}

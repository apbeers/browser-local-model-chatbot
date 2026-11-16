// Models page: what's available, what's saved in this browser (OPFS), and delete.
import { h, icons, toast, confirmDialog, fmtNum } from "../ui.js";
import { cachedFraction, deleteModelFromCache, deleteOrphans, deleteAllModelCache, fmtBytes } from "../models.js";
import { gpuLabel } from "../device.js";

export async function renderModelsView(root, app) {
  root.innerHTML = "";
  const page = h("div", { class: "page" });
  root.append(page);
  page.append(
    h("h1", null, "Models"),
    h(
      "p",
      { class: "lede" },
      "Models are served from this site's GitHub Pages and saved in your browser's private storage (OPFS) after the first download, so they load offline. Delete them here to free space.",
    ),
  );

  if (!app.catalog) {
    page.append(h("div", { class: "card" }, "Model catalog not available."));
    return;
  }
  await app.refreshScan();
  const scan = app.scan || { byModel: {}, other: { bytes: 0, files: 0, entries: [] } };

  // Storage summary
  let est = null;
  try {
    est = await navigator.storage.estimate();
  } catch {
    /* ignore */
  }
  let persisted = null;
  try {
    persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
  } catch {
    /* ignore */
  }
  const savedBytes = Object.values(scan.byModel).reduce((a, b) => a + b.bytes, 0) + scan.other.bytes;
  const summary = h(
    "div",
    { class: "card" },
    h(
      "dl",
      { class: "kv" },
      h("dt", null, "Saved models"),
      h("dd", null, fmtBytes(savedBytes)),
      h("dt", null, "Browser storage used"),
      h("dd", null, est ? `${fmtBytes(est.usage)} of ${fmtBytes(est.quota)} available to this site` : "unknown"),
      h("dt", null, "Persistent storage"),
      h("dd", null, persisted == null ? "unknown" : persisted ? "granted (browser won't evict data)" : "not granted (browser may evict data under pressure)"),
      h("dt", null, "GPU"),
      h("dd", null, gpuLabel(app.gpu) + (app.gpu && app.gpu.available ? (app.gpu.shaderF16 ? " · shader-f16 supported" : " · no shader-f16 (use f32 models)") : "")),
    ),
  );
  const actions = h("div", { class: "row", style: "margin-top:12px" });
  if (persisted === false && navigator.storage.persist) {
    actions.append(
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: async () => {
            const ok = await navigator.storage.persist();
            toast(ok ? "Persistent storage granted" : "The browser declined persistent storage");
            renderModelsView(root, app);
          },
        },
        "Request persistent storage",
      ),
    );
  }
  if (scan.other.files) {
    actions.append(
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: async () => {
            await deleteOrphans(scan);
            toast("Removed leftover files");
            renderModelsView(root, app);
          },
        },
        `Remove ${fmtBytes(scan.other.bytes)} of leftover files`,
      ),
    );
  }
  if (savedBytes > 0) {
    actions.append(
      h(
        "button",
        {
          class: "btn btn-danger",
          type: "button",
          onclick: async () => {
            if (!(await confirmDialog("Delete all saved models?", "Every downloaded model is removed from this browser. Chats and stats are kept."))) return;
            if (app.llm.modelId) await app.llm.unload();
            await deleteAllModelCache();
            toast("All saved models deleted");
            await app.refreshScan();
            app.renderStats();
            app.updateFoot();
            renderModelsView(root, app);
          },
        },
        "Delete all saved models",
      ),
    );
  }
  if (actions.childNodes.length) summary.append(actions);
  page.append(summary);

  page.append(h("h2", null, "Available models"));
  const list = h("div", { class: "cards" });
  page.append(list);

  for (const m of app.catalog.models) {
    const b = scan.byModel[m.id] || { bytes: 0, files: 0 };
    const frac = cachedFraction(m, scan);
    const saved = frac > 0.97;
    const partial = !saved && b.bytes > 0;
    const usable = app.modelUsable(m);
    const loaded = app.llm.modelId === m.id;
    const badges = h("div", { class: "row", style: "gap:6px;margin-top:6px" });
    if (loaded) badges.append(h("span", { class: "badge good", html: icons.check + "Loaded" }));
    if (saved) badges.append(h("span", { class: "badge good", html: icons.check + "Saved in browser" }));
    else if (partial) badges.append(h("span", { class: "badge" }, `Partly saved · ${Math.round(frac * 100)}%`));
    else badges.append(h("span", { class: "badge" }, "Not downloaded"));
    if (!usable && app.gpu && app.gpu.available) badges.append(h("span", { class: "badge bad", html: icons.warn + "Needs shader-f16" }));
    badges.append(h("span", { class: "badge" }, m.host === "main" ? "Hosted on this site" : "Hosted on " + (app.catalog.hosts[m.host]?.repo || m.host)));

    const card = h(
      "div",
      { class: "card model-card" },
      h(
        "div",
        null,
        h("h3", null, m.label),
        h("div", { class: "id" }, m.id),
        h(
          "div",
          { class: "facts" },
          h("span", null, `${m.params ? fmtNum(m.params, 2) + "B params" : ""}`),
          h("span", null, `Quantization ${m.quant}`),
          h("span", null, `Download ${fmtBytes(m.bytes)}`),
          h("span", null, `GPU memory ≈ ${fmtNum(m.vramMB, 0)} MB`),
          h("span", null, `Context ${m.contextWindow || "–"} tokens`),
          b.bytes ? h("span", null, `Using ${fmtBytes(b.bytes)} in ${b.files} files`) : null,
        ),
        badges,
      ),
    );
    const act = h("div", { class: "actions" });
    const loadBtn = h(
      "button",
      {
        class: "btn btn-primary",
        type: "button",
        disabled: !usable || app.llm.state === "loading" || app.llm.state === "generating" || loaded ? true : null,
        onclick: async () => {
          const prog = h("div", { class: "progress" }, h("div", { class: "progress-fill" }));
          card.append(prog);
          app.onLoadProgress = (r) => {
            prog.firstChild.style.width = Math.round((r.progress || 0) * 100) + "%";
            loadBtn.textContent = Math.round((r.progress || 0) * 100) + "%";
          };
          loadBtn.disabled = true;
          await app.loadModel(m.id);
          app.onLoadProgress = null;
          renderModelsView(root, app);
        },
      },
      loaded ? "Loaded" : saved ? "Load" : "Download & load",
    );
    act.append(loadBtn);
    if (b.bytes > 0) {
      act.append(
        h(
          "button",
          {
            class: "btn btn-danger",
            type: "button",
            disabled: app.llm.state === "loading" ? true : null,
            onclick: async () => {
              if (!(await confirmDialog(`Delete ${m.label}?`, `Frees ${fmtBytes(b.bytes)}. You can download it again any time.`))) return;
              if (app.llm.modelId === m.id) await app.llm.unload();
              await deleteModelFromCache(m, scan);
              toast(`${m.label} deleted`);
              await app.refreshScan();
              app.renderStats();
              app.updateFoot();
              renderModelsView(root, app);
            },
          },
          "Delete",
        ),
      );
    }
    card.append(act);
    list.append(card);
  }

  page.append(
    h(
      "p",
      { class: "muted", style: "font-size:13px;margin-top:20px" },
      `Engine: WebLLM ${app.catalog.webllm}. Model weights come from the MLC builds on Hugging Face (mlc-ai/*-MLC), re-hosted on GitHub Pages. Files larger than GitHub's 100 MB limit are split into parts and joined in the browser.`,
    ),
  );
}

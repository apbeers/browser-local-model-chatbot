// Models page: quick-select models grouped by size, what's saved in this
// browser (OPFS), auto-delete settings and deletion.
import { h, icons, toast, confirmDialog, fmtNum, relTime } from "../ui.js";
import { cacheInfo, deleteModelFromCache, deleteOrphans, deleteAllModelCache, fmtBytes } from "../models.js";
import { GROUP_LABELS } from "../catalog.js";
import { gpuLabel } from "../device.js";
import { getSettings, setSetting, getUsage, daysLeft, AUTO_DELETE_OPTIONS } from "../retention.js";

export function autoDeleteSelect(app, onChange) {
  const sel = h("select", { class: "select", id: "auto-delete", "aria-label": "Auto-delete downloaded models" });
  getSettings().then((s) => {
    for (const [v, label] of AUTO_DELETE_OPTIONS) sel.append(h("option", { value: String(v), selected: s.autoDeleteDays === v ? true : null }, label));
  });
  sel.onchange = async () => {
    await setSetting("autoDeleteDays", Number(sel.value));
    toast(Number(sel.value) ? `Models unused for ${sel.value} days will be deleted automatically` : "Auto-delete turned off");
    await app.autoDelete();
    if (onChange) onChange();
  };
  return sel;
}

export async function renderModelsView(root, app) {
  root.innerHTML = "";
  const page = h("div", { class: "page" });
  root.append(page);
  const rerender = () => renderModelsView(root, app);
  page.append(
    h("h1", null, "Models"),
    h(
      "p",
      { class: "lede" },
      "Models download from Hugging Face the first time you use them and are saved in this browser's private storage (OPFS). After that they load without a connection.",
    ),
  );
  if (!app.catalog) {
    page.append(h("div", { class: "card" }, "The model list isn't available."));
    return;
  }
  await app.refreshScan();
  const scan = app.scan || { byModel: {}, other: { bytes: 0, files: 0, entries: [] } };
  const settings = await getSettings();
  const usage = await getUsage();

  // ---- Storage summary ----
  let est = null;
  let persisted = null;
  try {
    est = await navigator.storage.estimate();
    persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
  } catch {
    /* ignore */
  }
  const savedBytes = Object.values(scan.byModel).reduce((a, b) => a + b.bytes, 0);
  const summary = h(
    "div",
    { class: "card" },
    h(
      "dl",
      { class: "kv" },
      h("dt", null, "Saved models"),
      h("dd", null, `${fmtBytes(savedBytes)} in ${Object.keys(scan.byModel).length} model(s)`),
      h("dt", null, "Browser storage"),
      h("dd", null, est ? `${fmtBytes(est.usage)} used of ${fmtBytes(est.quota)} available to this site` : "unknown"),
      h("dt", null, "Persistent storage"),
      h("dd", null, persisted == null ? "unknown" : persisted ? "granted (the browser won't clear it on its own)" : "not granted (the browser may clear it when space runs low)"),
      h("dt", null, "GPU"),
      h("dd", null, gpuLabel(app.gpu) + (app.gpu && app.gpu.available ? (app.gpu.shaderF16 ? " · supports f16 models" : " · f32 models only") : "")),
    ),
    h(
      "div",
      { class: "row", style: "margin-top:14px" },
      h("label", { for: "auto-delete" }, "Auto-delete downloaded models"),
      autoDeleteSelect(app, rerender),
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
            toast(ok ? "Persistent storage granted" : "The browser declined. Installing the app usually helps.");
            rerender();
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
            app.updateFoot();
            rerender();
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
            rerender();
          },
        },
        "Delete all saved models",
      ),
    );
  }
  if (actions.childNodes.length) summary.append(actions);
  page.append(summary);

  // ---- Model cards ----
  const card = (m) => {
    const info = cacheInfo(m, scan);
    const usable = app.modelUsable(m);
    const loaded = app.llm.modelId === m.id;
    const left = info.bytes ? daysLeft(usage[m.id], settings.autoDeleteDays) : null;
    const badges = h("div", { class: "row", style: "gap:6px;margin-top:6px" });
    if (loaded) badges.append(h("span", { class: "badge good", html: icons.check + "Loaded" }));
    if (info.complete) badges.append(h("span", { class: "badge good", html: icons.check + "Saved · works offline" }));
    else if (info.bytes) badges.append(h("span", { class: "badge" }, `Partly downloaded · ${Math.round(info.fraction * 100)}%`));
    if (!usable && app.gpu && app.gpu.available) badges.append(h("span", { class: "badge bad", html: icons.warn + "Needs a GPU with f16 support" }));
    if (m.reasoning) badges.append(h("span", { class: "badge" }, "Thinks before answering"));

    const c = h(
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
          m.params ? h("span", null, `${fmtNum(m.params, 2)}B params`) : null,
          h("span", null, m.quant),
          h("span", null, m.bytes != null ? `Download ${fmtBytes(m.bytes)}` : "Download size unknown"),
          h("span", null, `GPU memory ≈ ${fmtNum(m.vramMB / 1024, 1)} GB`),
          h("span", null, `Context ${m.contextWindow || "–"} tokens`),
          info.bytes ? h("span", null, `Using ${fmtBytes(info.bytes)}`) : null,
          info.bytes && usage[m.id] ? h("span", null, `Last used ${relTime(usage[m.id])}`) : null,
          left != null ? h("span", null, left === 0 ? "Deletes on next check" : `Auto-deletes in ${left} day${left === 1 ? "" : "s"} if unused`) : null,
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
        disabled: !usable || loaded || app.llm.state === "loading" || app.llm.state === "generating" ? true : null,
        onclick: async () => {
          const prog = h("div", { class: "progress" }, h("div", { class: "progress-fill" }));
          c.append(prog);
          app.onLoadProgress = (r) => {
            prog.firstChild.style.width = Math.round((r.progress || 0) * 100) + "%";
            loadBtn.textContent = Math.round((r.progress || 0) * 100) + "%";
          };
          loadBtn.disabled = true;
          await app.loadModel(m.id);
          app.onLoadProgress = null;
          rerender();
        },
      },
      loaded ? "Loaded" : info.complete ? "Load" : info.bytes ? "Resume download" : "Download",
    );
    act.append(loadBtn);
    if (info.bytes) {
      act.append(
        h(
          "button",
          {
            class: "btn btn-danger",
            type: "button",
            disabled: app.llm.state === "loading" ? true : null,
            onclick: async () => {
              if (!(await confirmDialog(`Delete ${m.label}?`, `Frees ${fmtBytes(info.bytes)}. You can download it again any time.`))) return;
              if (app.llm.modelId === m.id) await app.llm.unload();
              await deleteModelFromCache(m, scan, app.catalog);
              toast(`${m.label} deleted`);
              await app.refreshScan();
              app.renderStats();
              app.updateFoot();
              rerender();
            },
          },
          "Delete",
        ),
      );
    }
    c.append(act);
    return c;
  };

  const saved = app.catalog.all.filter((m) => cacheInfo(m, scan).bytes > 0);
  if (saved.length) {
    page.append(h("h2", null, "Saved in this browser"));
    page.append(h("div", { class: "cards" }, saved.map(card)));
  }
  for (const g of ["small", "medium", "large"]) {
    const ms = app.catalog.quick.filter((m) => m.group === g && !cacheInfo(m, scan).bytes);
    if (!ms.length) continue;
    page.append(h("h2", null, GROUP_LABELS[g]));
    page.append(h("div", { class: "cards" }, ms.map(card)));
  }

  // ---- More models ----
  const toggle = h("input", { type: "checkbox", id: "show-all", checked: settings.showAllModels ? true : null });
  toggle.onchange = async () => {
    await setSetting("showAllModels", toggle.checked);
    await app.refreshScan();
    rerender();
  };
  page.append(
    h("h2", null, "More models"),
    h(
      "div",
      { class: "card row" },
      toggle,
      h("label", { for: "show-all", style: "flex:1;min-width:200px" }, `Show all ${app.catalog.more.length} other WebLLM models in the picker (sizes not checked; many are too big for phones)`),
    ),
  );
  if (settings.showAllModels) {
    const more = app.catalog.more.filter((m) => !cacheInfo(m, scan).bytes);
    page.append(h("div", { class: "cards", style: "margin-top:12px" }, more.map(card)));
  }

  page.append(
    h(
      "p",
      { class: "muted", style: "font-size:13px;margin-top:20px" },
      `Engine: WebLLM ${app.catalog.webllm}. Weights come from the mlc-ai builds on Hugging Face; model libraries from the mlc-ai/binary-mlc-llm-libs repo on GitHub.`,
    ),
  );
}

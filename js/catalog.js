// Model catalog: models/catalog.json lists every self-hosted model and which
// GitHub Pages site serves it. We merge each entry with WebLLM's prebuilt
// record (context window, VRAM estimate, required GPU features) and point the
// URLs at our own hosts instead of Hugging Face.

const CATALOG_URL = new URL("../models/catalog.json", import.meta.url).href;

let catalogPromise = null;

export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL, { cache: "no-cache" })
      .catch(() => fetch(CATALOG_URL)) // offline: service worker answers
      .then((r) => {
        if (!r.ok) throw new Error("Could not load model catalog (" + r.status + ")");
        return r.json();
      })
      .then(resolveCatalog)
      .catch((err) => {
        catalogPromise = null;
        throw err;
      });
  }
  return catalogPromise;
}

function resolveCatalog(cat) {
  const hostBase = {};
  for (const [name, h] of Object.entries(cat.hosts)) {
    hostBase[name] = new URL(h.base, CATALOG_URL).href;
  }
  const models = cat.models.map((m) => {
    const base = hostBase[m.host];
    const modelUrl = new URL(`${m.id}/resolve/main/`, base).href;
    const libUrl = new URL(`libs/${m.lib}`, base).href;
    const splits = {};
    for (const [file, info] of Object.entries(m.splits || {})) {
      splits[new URL(file, modelUrl).href] = info;
    }
    return { ...m, modelUrl, libUrl, splitUrls: splits, hostBase: base };
  });
  return { ...cat, hostBase, models };
}

export function splitMap(catalog) {
  const map = {};
  for (const m of catalog.models) Object.assign(map, m.splitUrls);
  return map;
}

// Build a WebLLM AppConfig whose model_list only contains our hosted models.
export function buildAppConfig(catalog, prebuiltAppConfig) {
  const model_list = [];
  for (const m of catalog.models) {
    const pre = prebuiltAppConfig.model_list.find((r) => r.model_id === m.id) || {};
    const features = new Set(pre.required_features || []);
    if (m.requiresF16) features.add("shader-f16");
    model_list.push({
      ...pre,
      model: m.modelUrl,
      model_id: m.id,
      model_lib: m.libUrl,
      required_features: [...features],
    });
  }
  return { model_list, cacheBackend: "opfs", opfsAccessMode: "auto" };
}

export function prebuiltRecord(prebuiltAppConfig, id) {
  return prebuiltAppConfig.model_list.find((r) => r.model_id === id) || null;
}

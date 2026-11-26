// Gets the builder (coding) model loaded with the builder's context size,
// asking before a first download. onStatus(text) receives progress messages.
// Returns true when the model is ready.
import { app } from "../../core/api.js";

export async function prepareBuilder(onStatus = () => {}) {
  if (!app.gpu || !app.gpu.available) {
    onStatus("This browser has no WebGPU, so the coding model can't run here.");
    return false;
  }
  const id = app.builder.pickBuilderModel(app.gpu, (await app.settings.get()).coderModel);
  const ctx = app.builder.builderContextWindow();
  if (app.llm.modelId === id && app.llm.contextWindow === ctx) return true;
  const off = app.on("load-progress", (r) => onStatus(`Loading the coding model… ${Math.round((r.progress || 0) * 100)}%`));
  try {
    const ok = await app.loadModel(id, app.builder.builderLoadOptions());
    if (!ok) onStatus("The coding model didn't load. Check the message at the top of the Chat page.");
    return ok;
  } finally {
    off();
  }
}

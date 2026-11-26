// Benchmark page: runs the fixed prompt suite (js/core/benchmark.js) on one
// model and shows the results next to earlier benchmark runs on this device.
import { app } from "../../core/api.js";
import { h, toast, fmtNum, fmtMs, fmtDate } from "../dom.js";

const { median } = app.stats;
let running = null; // AbortController while a run is in progress

function resultsTable(rows) {
  const cols = ["Prompt", "Prompt tok", "Prefill tok/s", "First token", "Output tok", "Decode tok/s"];
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "table" },
      h("thead", null, h("tr", null, cols.map((c, i) => h("th", { class: i ? "num" : null }, c)))),
      h(
        "tbody",
        null,
        rows.map((r) =>
          h(
            "tr",
            null,
            h("td", null, r.label),
            h("td", { class: "num" }, fmtNum(r.promptTokens, 0)),
            h("td", { class: "num" }, fmtNum(r.prefillTps, 0)),
            h("td", { class: "num" }, fmtMs(r.ttftMs)),
            h("td", { class: "num" }, fmtNum(r.completionTokens, 0)),
            h("td", { class: "num" }, fmtNum(r.decodeTps)),
          ),
        ),
      ),
    ),
  );
}

// Median per prompt over a list of benchmark generation records.
function byPrompt(gens) {
  return app.benchmark.PROMPTS.map((p) => {
    const g = gens.filter((x) => x.bench && x.bench.prompt === p.key);
    const pick = (k) => median(g.map((x) => x[k]));
    return { label: `${p.label}${g.length > 1 ? ` (median of ${g.length})` : ""}`, promptTokens: pick("promptTokens"), prefillTps: pick("prefillTps"), ttftMs: pick("ttftMs"), completionTokens: pick("completionTokens"), decodeTps: pick("decodeTps") };
  });
}

async function history(root, modelId) {
  const me = (await app.device.getDeviceIdentity()).id;
  const sessions = (await app.stats.loadAllSessions()).filter((s) => s.deviceId === me && s.model.id === modelId);
  const runs = sessions.flatMap((s) => s.generations.filter((g) => g.kind === "benchmark" && g.bench && g.bench.suite === app.benchmark.SUITE));
  root.replaceChildren(
    ...[
    h("h2", null, "Earlier runs of this model on this device"),
    runs.length ? resultsTable(byPrompt(runs)) : h("p", { class: "muted" }, "None yet."),
    runs.length ? h("p", { class: "note" }, `${runs.length} results since ${fmtDate(Math.min(...runs.map((g) => g.at)))}. All runs from every device are in the Stats dashboard (Type: Benchmarks).`) : null,
    ].filter(Boolean), // replaceChildren would show a null as the text "null"
  );
}

export async function render(root) {
  const page = h("div", { class: "page", style: "max-width:860px" });
  root.replaceChildren(page);
  page.append(
    h("h1", null, "Benchmark"),
    h(
      "p",
      { class: "lede" },
      `Runs ${app.benchmark.PROMPTS.length} fixed prompts with greedy decoding and a fixed seed, so results are comparable across devices. A warm-up run comes first and isn't counted.`,
    ),
  );
  if (!app.catalog || !app.gpu || !app.gpu.available) {
    page.append(h("div", { class: "card" }, "Benchmarks need WebGPU and the model list."));
    return;
  }
  const usable = app.catalog.all.filter((m) => app.modelUsable(m) && (app.isSaved(m) || m.quick));
  const pick = h("select", { class: "select", id: "bench-model" }, usable.map((m) => h("option", { value: m.id, selected: m.id === app.llm.modelId ? true : null }, `${app.isSaved(m) ? "✓ " : ""}${m.label}`)));
  const reps = h("select", { class: "select", id: "bench-reps" }, [1, 2, 3, 5].map((n) => h("option", { value: n, selected: n === 2 ? true : null }, `${n}×`)));
  const status = h("p", { class: "note", role: "status" });
  const fill = h("div", { class: "progress-fill" });
  const results = h("div");
  const past = h("div");
  const btn = h("button", { class: "btn btn-primary", type: "button" }, "Run benchmark");
  pick.onchange = () => history(past, pick.value);

  btn.onclick = async () => {
    if (running) {
      running.abort();
      app.llm.interrupt();
      return;
    }
    const id = pick.value;
    if (app.llm.modelId !== id && !(await app.loadModel(id))) return;
    running = new AbortController();
    btn.textContent = "Stop";
    results.replaceChildren();
    try {
      const gens = await app.benchmark.runBenchmark(app.llm, {
        reps: Number(reps.value),
        signal: running.signal,
        onStep: ({ done, total, label }) => {
          status.textContent = `${label}… (${done}/${total})`;
          fill.style.width = `${(done / total) * 100}%`;
        },
      });
      status.textContent = "Done. Results are saved to your stats.";
      results.replaceChildren(h("h2", null, "This run"), resultsTable(byPrompt(gens)));
      history(past, id);
    } catch (err) {
      status.textContent = "Stopped: " + (err.message || err);
    } finally {
      running = null;
      btn.textContent = "Run benchmark";
    }
  };

  page.append(
    h(
      "div",
      { class: "card" },
      h("div", { class: "row" }, h("label", { for: "bench-model" }, "Model"), pick, h("label", { for: "bench-reps" }, "Repeats"), reps, h("span", { class: "spacer" }), btn),
      h("div", { class: "progress", style: "margin-top:12px" }, fill),
      status,
      h("details", { class: "note" }, h("summary", null, "The prompts"), h("ul", null, app.benchmark.PROMPTS.map((p) => h("li", null, `${p.label} (max ${p.maxTokens} tokens): `, h("em", null, p.messages[0].content.slice(0, 120) + (p.messages[0].content.length > 120 ? "…" : "")))))),
    ),
    results,
    past,
  );
  if (pick.value) history(past, pick.value);
  if (!usable.length) toast("No models your GPU can run");
}

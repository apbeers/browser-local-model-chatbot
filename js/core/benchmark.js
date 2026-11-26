// Benchmark mode: the same fixed prompts, greedy decoding (temperature 0) and
// seed on every device, so numbers are directly comparable. Each prompt runs
// in a fresh context. Results are ordinary stats records with kind "benchmark"
// plus {bench: {suite, prompt, rep}}.

export const SUITE = "v1";

const PASSAGE =
  "The bicycle is one of the most efficient machines ever built for moving a person. A rider pushes the pedals, which turn a crank " +
  "connected to a front sprocket. A chain carries that motion to a smaller rear sprocket fixed to the back wheel, so each turn of the " +
  "pedals turns the wheel more than once. Gears let the rider trade speed for force: low gears make hills easier, high gears make flat " +
  "roads faster. The frame, usually a diamond of steel, aluminium or carbon tubes, holds everything in place while staying light. " +
  "Balance comes from steering: when a bike starts to lean, the rider turns slightly into the lean and the wheels move back under the " +
  "centre of mass. The spinning wheels and the geometry of the fork help this happen almost automatically at speed. Brakes press pads " +
  "against the rim or a disc to turn motion into heat. Pneumatic tyres cushion bumps and keep rolling resistance low. Together these " +
  "simple parts let a person travel three to four times faster than walking for the same effort, which is why bicycles remain popular " +
  "for commuting, sport and delivery work in cities around the world. ";

export const PROMPTS = [
  { key: "short", label: "Short answer", maxTokens: 64, messages: [{ role: "user", content: "Write one sentence describing the ocean." }] },
  { key: "medium", label: "Medium answer", maxTokens: 256, messages: [{ role: "user", content: "Explain how a refrigerator keeps food cold, in about 150 words." }] },
  {
    key: "long-prompt",
    label: "Long prompt",
    maxTokens: 96,
    messages: [{ role: "user", content: PASSAGE + PASSAGE + "\n\nSummarize the text above in two sentences." }],
  },
];

// Runs the suite on the loaded model. onStep({done, total, label}) reports progress.
export async function runBenchmark(llm, { reps = 2, onStep, signal } = {}) {
  if (!llm.modelId) throw new Error("Load a model first");
  const total = 1 + PROMPTS.length * reps;
  let done = 0;
  const results = [];
  const step = (label) => onStep && onStep({ done, total, label });
  const run = async (p, rep, warmup) => {
    if (signal && signal.aborted) throw new Error("Benchmark stopped");
    step(warmup ? "Warm-up" : `${p.label} (${rep + 1}/${reps})`);
    const { gen } = await llm.generate(p.messages, {
      kind: warmup ? "benchmark-warmup" : "benchmark",
      request: { temperature: 0, top_p: 1, seed: 42, max_tokens: p.maxTokens },
      meta: { bench: { suite: SUITE, prompt: p.key, rep, warmup } },
    });
    done++;
    if (!warmup) results.push(gen);
  };
  await run(PROMPTS[0], 0, true); // compiles shaders / warms caches; not counted
  for (let rep = 0; rep < reps; rep++) for (const p of PROMPTS) await run(p, rep, false);
  step("Done");
  return results;
}

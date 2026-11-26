// Line diff (longest common subsequence) and a compact unified-diff view.
import { h } from "./dom.js";

// Returns [{op: " " | "+" | "-", text}] turning a into b.
export function diffLines(a, b) {
  const A = (a || "").split("\n");
  const B = (b || "").split("\n");
  const n = A.length;
  const m = B.length;
  if (n * m > 4e6) return [...A.map((text) => ({ op: "-", text })), ...B.map((text) => ({ op: "+", text }))];
  // dp[i][j] = LCS length of A[i..] and B[j..]
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ op: " ", text: A[i] });
      i++;
      j++;
    }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "-", text: A[i++] });
    else out.push({ op: "+", text: B[j++] });
  }
  while (i < n) out.push({ op: "-", text: A[i++] });
  while (j < m) out.push({ op: "+", text: B[j++] });
  return out;
}

export function diffStats(ops) {
  return { added: ops.filter((o) => o.op === "+").length, removed: ops.filter((o) => o.op === "-").length };
}

// Unified view with `context` unchanged lines around each change.
export function diffView(a, b, { context = 3 } = {}) {
  const ops = diffLines(a, b);
  const { added, removed } = diffStats(ops);
  if (!added && !removed) return h("p", { class: "note" }, "No differences.");
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, k) => {
    if (o.op !== " ") for (let d = -context; d <= context; d++) if (ops[k + d]) keep[k + d] = true;
  });
  const lines = [];
  let skipped = 0;
  ops.forEach((o, k) => {
    if (!keep[k]) {
      skipped++;
      return;
    }
    if (skipped) lines.push(h("div", { class: "diff-skip" }, `… ${skipped} unchanged line${skipped === 1 ? "" : "s"} …`));
    skipped = 0;
    lines.push(h("div", { class: "diff-" + (o.op === "+" ? "add" : o.op === "-" ? "del" : "ctx") }, (o.op === " " ? "  " : o.op + " ") + o.text));
  });
  if (skipped) lines.push(h("div", { class: "diff-skip" }, `… ${skipped} unchanged line${skipped === 1 ? "" : "s"} …`));
  return h("div", null, h("p", { class: "note" }, `${added} line${added === 1 ? "" : "s"} added, ${removed} removed`), h("pre", { class: "diff" }, lines));
}

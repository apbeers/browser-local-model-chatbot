#!/usr/bin/env node
// Writes docs/files.json: the list of customizable UI files shown in Studio,
// each with a one-line summary for the coding model and the doc that explains it.
// Run by tools/build_sw.mjs; fails if a file or doc is missing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// path, summary, doc (relative to docs/)
const FILES = [
  ["css/custom.css", "Extra styles loaded after app.css. Empty by default.", "CSS_CLASSES.md"],
  ["js/ui/layout.js", "Builds the page skeleton: sidebar, top bar, chat area, page sections.", "components/layout.md"],
  ["js/ui/chat/message.js", "Draws one chat message (user bubble or assistant reply with stats).", "components/message.md"],
  ["js/ui/chat/empty-state.js", "The screen of a new, empty chat with suggestion buttons.", "components/empty-state.md"],
  ["js/ui/chat/stats-strip.js", "The row of live speed numbers above the chat.", "components/stats-strip.md"],
  ["js/ui/chat/chat-view.js", "The chat page: opens chats, sends messages, streams replies.", "components/chat-view.md"],
  ["js/ui/chat/model-picker.js", "The model dropdown and Load button; loadModel().", "components/model-picker.md"],
  ["js/ui/chat/chat-actions.js", "Menus to rename, move, export and delete chats and projects.", "components/chat-actions.md"],
  ["js/ui/sidebar.js", "Sidebar: new chat, search, projects and chats list.", "components/sidebar.md"],
  ["js/ui/main.js", "Entry point: starts the app and switches pages.", "components/main.md"],
  ["js/ui/dom.js", "Helpers: h() to create elements, dialogs, toast, number formatting.", "components/dom.md"],
  ["js/ui/markdown.js", "Turns Markdown replies into safe HTML.", "components/helpers.md"],
  ["js/ui/state.js", "Shared UI state and localStorage helpers.", "components/helpers.md"],
  ["js/ui/views/settings.js", "Settings page.", "components/views.md"],
  ["js/ui/views/models.js", "Models page: downloads, storage, auto-delete.", "components/views.md"],
  ["js/ui/views/benchmark.js", "Benchmark page.", "components/views.md"],
  ["js/ui/views/dashboard.js", "Stats dashboard: filters and number tiles.", "components/views.md"],
  ["js/ui/views/dashboard-charts.js", "Stats dashboard charts.", "components/views.md"],
  ["js/ui/views/dashboard-tables.js", "Stats dashboard tables and session details.", "components/views.md"],
  ["js/ui/charts.js", "Hand-made SVG charts.", "components/helpers.md"],
  ["css/app.css", "All default styles (large: prefer css/custom.css).", "CSS_CLASSES.md"],
];

const files = FILES.map(([p, summary, doc]) => {
  const full = path.join(repo, p);
  if (!fs.existsSync(full)) throw new Error(`missing file ${p}`);
  if (!fs.existsSync(path.join(repo, "docs", doc))) throw new Error(`missing doc docs/${doc}`);
  const lines = fs.readFileSync(full, "utf8").split("\n").length;
  return { path: p, summary, doc, lines };
});
// docs/patterns/index.json: each pattern's keywords (first line "keywords: a, b").
const pdir = path.join(repo, "docs/patterns");
const patterns = fs
  .readdirSync(pdir)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => {
    const first = fs.readFileSync(path.join(pdir, f), "utf8").split("\n")[0];
    if (!first.startsWith("keywords:")) throw new Error(`docs/patterns/${f} must start with "keywords: ..."`);
    return { file: f, keywords: first.slice(9).split(",").map((s) => s.trim()).filter(Boolean) };
  });
fs.writeFileSync(path.join(pdir, "index.json"), JSON.stringify({ patterns }, null, 1) + "\n");
for (const t of JSON.parse(fs.readFileSync(path.join(repo, "docs/templates/index.json"), "utf8")).templates) {
  if (!fs.existsSync(path.join(repo, "docs/templates", t.file))) throw new Error(`missing template ${t.file}`);
}

fs.writeFileSync(path.join(repo, "docs/files.json"), JSON.stringify({ files }, null, 1) + "\n");
console.log(`docs/files.json: ${files.length} files`);

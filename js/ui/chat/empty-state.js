// What a new, empty chat shows: a greeting, suggestion buttons and, when the
// app isn't installed yet, how to add it to the Home Screen.
import { app } from "../../core/api.js";
import { lsGet, lsSet } from "../state.js";
import { h } from "../dom.js";
import { installHelp } from "../install-help.js";

export const SUGGESTIONS = [
  "Explain how a transformer language model works in three short paragraphs.",
  "Write a Python function that checks if a string is a palindrome, with tests.",
  "Give me five ideas for a weekend project using a Raspberry Pi.",
  "Summarize the pros and cons of running AI models on-device.",
];

// onPick(text) runs when a suggestion is tapped. project: the chat's project or null.
export function emptyState({ onPick, project }) {
  const ready = app.llm.modelId ? `${app.llm.model.label} is loaded.` : "Pick a model above. It downloads once, is saved on this device, and then works offline.";
  const box = h(
    "div",
    { class: "empty-state" },
    h("img", { src: "icons/icon.svg", width: 48, height: 48, alt: "" }),
    h("h2", null, project ? `New chat in ${project.name}` : "Chat with a model on this device"),
    h("p", null, ready),
    project && project.instructions ? h("p", { class: "muted" }, "Project instructions are sent with every message.") : null,
    h(
      "div",
      { class: "suggestions" },
      SUGGESTIONS.map((t) => h("button", { type: "button", class: "suggestion", onclick: () => onPick(t) }, t)),
    ),
  );
  const help = lsGet("hideInstall") === "1" ? null : installHelp();
  if (help) {
    box.append(
      h(
        "div",
        { class: "install-card" },
        h("strong", null, "Use it offline"),
        help,
        h(
          "button",
          {
            class: "md-copy",
            type: "button",
            onclick: (e) => {
              lsSet("hideInstall", "1");
              e.target.closest(".install-card").remove();
            },
          },
          "Dismiss",
        ),
      ),
    );
  }
  return box;
}

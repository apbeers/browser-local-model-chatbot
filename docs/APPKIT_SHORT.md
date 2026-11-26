# appkit (short version)
One HTML file, offline, sandboxed. `window.appkit` is always there; all calls are async.
- Save: `await appkit.storage.set("items", items)`; load: `items = await appkit.storage.get("items", [])`.
  No localStorage (blocked).
- AI: `const text = await appkit.ai.ask(prompt, { onToken: (soFar) => (out.textContent = soFar) })`; wrap in try/catch.
- Tools: `await appkit.tools.call("wikipedia", "Paris")`, also "weather", "calculator", "datetime".
- `appkit.notify("Saved")`, `appkit.download("data.csv", text, "text/csv")`.
- Colors: `var(--page)`, `var(--surface)`, `var(--ink)`, `var(--ink-2)`, `var(--accent)`, `var(--border)` (light/dark automatic).
- Classes: `ak-app` page, `ak-header`, `ak-card`, `ak-stack`, `ak-row`, `ak-grid`, `ak-split`, `ak-btn primary`,
  `ak-input`, `ak-textarea`, `ak-select`, `ak-label`, `ak-list`, `ak-badge`, `ak-stat`, `ak-muted`, `ak-empty`.
- Must work on phones and wide screens: use ak-grid / ak-split / flex-wrap, no fixed widths.

# Colors and theme tokens

All colors come from CSS custom properties ("tokens") set on `:root` in css/app.css.
Light mode and dark mode set different values. Always use tokens: `color: var(--ink);`.

| Token | Used for |
|---|---|
| `--page` | app background behind everything |
| `--surface` | cards, inputs, the message composer |
| `--surface-2` | sidebar, table headers |
| `--surface-3` | hover backgrounds, progress tracks |
| `--ink` | main text |
| `--ink-2` | secondary text |
| `--muted` | hints, labels, timestamps |
| `--border` | hairline borders |
| `--accent` | buttons, links, highlights |
| `--accent-ink` | text on top of `--accent` |
| `--accent-soft` | faint accent background |
| `--user-bubble` | background of the user's chat bubbles |
| `--critical-ink` | error text |
| `--radius`, `--radius-sm` | corner radius (12px, 8px) |
| `--font`, `--mono` | text font, code font |
| `--sidebar-w` | sidebar width (280px) |

A theme sets the first 10 tokens for light and dark. The rest are derived.

## Light and dark
- `:root` holds light values.
- Dark values apply under `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])`,
  and under `:root[data-theme="dark"]`.
- Changing a token in css/custom.css changes it in BOTH modes unless you repeat it in the dark selectors:
```css
:root { --radius: 18px; }                      /* both modes */
:root[data-theme="dark"] { --accent: #ff9a3c; } /* dark mode chosen in Settings */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --accent: #ff9a3c; } /* dark mode from the system */
}
```

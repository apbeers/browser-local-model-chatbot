# js/ui/dom.js — DOM helpers
- `h(tag, attrs, ...children)` creates an element. attrs: `class`, `html` (innerHTML), `dataset`,
  `onclick`/`oninput`/... (event listeners), anything else becomes an attribute. Children: strings, elements, arrays.
- `s(tag, attrs, ...children)` the same for SVG.
- `icons` (copy, trash, edit, redo, check, x, download, upload, more, plus, folder, warn) and
  `iconBtn(name, label, onclick)`.
- `toast(text, ms)`, `await confirmDialog(title, body, okLabel, danger)`, `await promptDialog(title, value)`,
  `modal(title, element)` (returns the `<dialog>`).
- `fmtNum(n, digits)`, `fmtMs(ms)`, `fmtDate(t)`, `relTime(t)`, `downloadFile(name, text, type)`, `await pickFile(accept)`.

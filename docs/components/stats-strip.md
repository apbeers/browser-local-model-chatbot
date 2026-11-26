# js/ui/chat/stats-strip.js — live numbers
`renderStats()` redraws `state.els.statsStrip` with tiles made by `stat(label, valueHtml, sub, extraClass)`:
Decode tok/s (live while streaming, from `state.live.tps`), Prefill, First token, Context (with a bar),
Session, Load, GPU. Tiles with class `wide-only` are hidden on phones.
Data: `app.llm.session.r.generations` (last reply) and `app.llm.session.summary()`.

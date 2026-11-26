# js/ui/chat/empty-state.js — new chat screen
`emptyState({ onPick, project })` returns the greeting, the `SUGGESTIONS` buttons (tapping one calls
`onPick(text)`, which sends it) and, if the app isn't installed, an "Use it offline" card.
Edit `SUGGESTIONS` to change the example prompts.

# js/ui/chat/model-picker.js — model dropdown
- `initModelPicker()` wires the `<select id="model-select">` and Load button and the loading bar.
- `populateModelSelect()` fills the dropdown with `<optgroup>`s by size; saved models start with "✓ ".
- `loadModel(id, opts)` asks before big downloads, loads the model, shows errors; returns true/false.
  Also available as `app.loadModel`.
- `selectModel(id)` picks a model without loading it. `updateLoadButton()` refreshes the button text.

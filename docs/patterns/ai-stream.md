keywords: ai, ask, generate, write, summarize, translate, chat, assistant, stream, model
# Pattern: ask the on-device AI and stream the answer
```js
button.onclick = async () => {
  button.disabled = true; out.textContent = "Thinking…";
  try {
    const text = await appkit.ai.chat(
      [{ role: "system", content: "Answer in under 100 words." }, { role: "user", content: input.value }],
      { onToken: (soFar) => (out.textContent = soFar) }
    );
    out.textContent = text;
  } catch (err) { out.textContent = "Error: " + err.message; }
  finally { button.disabled = false; }
};
```
For structured data ask for JSON: `JSON.parse(await appkit.ai.ask(prompt, { json: true }))`.

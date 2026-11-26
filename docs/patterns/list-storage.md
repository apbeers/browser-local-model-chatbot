keywords: list, todo, items, save, add, delete, storage, crud
# Pattern: saved list with add and delete
```js
let items = [];
async function load() { items = await appkit.storage.get("items", []); render(); }
async function save() { await appkit.storage.set("items", items); render(); }
function render() {
  list.replaceChildren(...items.map((item) => {
    const li = document.createElement("li");
    const span = document.createElement("span"); span.textContent = item.text;
    const del = document.createElement("button"); del.className = "ak-btn ghost"; del.textContent = "Delete";
    del.onclick = () => { items = items.filter((x) => x.id !== item.id); save(); };
    li.append(span, del); return li;
  }));
}
form.onsubmit = (e) => { e.preventDefault(); items.push({ id: Date.now(), text: input.value.trim() }); input.value = ""; save(); };
load();
```

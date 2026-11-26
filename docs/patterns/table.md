keywords: table, rows, columns, data, csv, export, sort, spreadsheet, records
# Pattern: sortable table with CSV export
```html
<div class="ak-scroll"><table class="ak-table" id="table"><thead><tr><th data-k="name">Name</th><th data-k="amount">Amount</th></tr></thead><tbody></tbody></table></div>
<button class="ak-btn" id="csv">Export CSV</button>
```
```js
let rows = await appkit.storage.get("rows", []), sortKey = "name";
function render() {
  const sorted = [...rows].sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : -1));
  table.tBodies[0].replaceChildren(...sorted.map((r) => {
    const tr = document.createElement("tr");
    for (const k of ["name", "amount"]) { const td = document.createElement("td"); td.textContent = r[k]; tr.append(td); }
    return tr;
  }));
}
table.tHead.onclick = (e) => { if (e.target.dataset.k) { sortKey = e.target.dataset.k; render(); } };
csv.onclick = () => appkit.download("data.csv", ["name,amount", ...rows.map((r) => `${r.name},${r.amount}`)].join("\n"), "text/csv");
render();
```

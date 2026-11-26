keywords: form, input, calculate, calculator, number, convert, select, live
# Pattern: inputs that update results live
```html
<form id="form" class="ak-card ak-stack">
  <label class="ak-label">Amount <input class="ak-input" id="amount" type="number" value="10"></label>
  <label class="ak-label">Unit <select class="ak-select" id="unit"><option value="km">km</option><option value="mi">miles</option></select></label>
</form>
<div class="ak-card ak-stat"><b id="result">0</b><span>Result</span></div>
```
```js
const $ = (id) => document.getElementById(id);
function update() {
  const amount = Number($("amount").value) || 0;
  $("result").textContent = ($("unit").value === "km" ? amount * 0.621 : amount * 1.609).toFixed(2);
}
$("form").addEventListener("input", update); update();
```

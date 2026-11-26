keywords: timer, countdown, stopwatch, pomodoro, clock, interval, alarm, time
# Pattern: timer that survives reloads
```js
let endsAt = await appkit.storage.get("endsAt", null);
function start(minutes) { endsAt = Date.now() + minutes * 60000; appkit.storage.set("endsAt", endsAt); }
setInterval(() => {
  if (!endsAt) return (display.textContent = "--:--");
  const left = Math.max(0, endsAt - Date.now());
  display.textContent = new Date(left).toISOString().slice(14, 19);
  if (left === 0) { endsAt = null; appkit.storage.remove("endsAt"); appkit.notify("Time's up!"); }
}, 250);
```

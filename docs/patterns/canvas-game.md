keywords: game, canvas, animation, draw, loop, score, play, physics
# Pattern: canvas game loop that scales to any screen
```html
<canvas id="game" width="800" height="600" style="width:100%;aspect-ratio:4/3;touch-action:none"></canvas>
```
```js
const ctx = game.getContext("2d");
const color = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  // update positions using dt (seconds), then draw:
  ctx.clearRect(0, 0, 800, 600);
  ctx.fillStyle = color("--accent");
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// pointer position in canvas units:
game.addEventListener("pointermove", (e) => { const r = game.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * 800; });
```

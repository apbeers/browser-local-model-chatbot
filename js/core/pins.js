// Pin a Studio app to the Home Screen / desktop as its own installable app.
//
// Each pin lives at  pins/<appId>/  with its own web app manifest (distinct id
// and scope) and icons generated on the device. The service worker serves:
//   pins/<id>/                       -> pin.html (the locked app host)
//   pins/<id>/manifest.webmanifest   -> from Cache "pins"
//   pins/<id>/icon-180|192|512.png   -> from Cache "pins"
// The app's HTML is also packed (compressed, base64url) into the start URL's
// hash, so a pinned app can install itself even when its storage starts empty,
// as it does on iPhone/iPad where Home Screen apps don't share Safari's storage.
const SCOPE = new URL("../../", import.meta.url).href;

export const pinUrl = (id) => `${SCOPE}pins/${encodeURIComponent(id)}/`;

async function pack(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function unpack(b64) {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

// Draws the icon: rounded colored square with the app's emoji.
async function icon(size, { emoji, color }, maskable = false) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = color || "#2a78d6";
  if (maskable) g.fillRect(0, 0, size, size);
  else {
    const r = size * 0.22;
    g.beginPath();
    g.roundRect(0, 0, size, size, r);
    g.fill();
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `${Math.round(size * (maskable ? 0.42 : 0.56))}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.fillText(emoji || "✨", size / 2, size / 2 + size * 0.04);
  return new Promise((res) => c.toBlob(res, "image/png"));
}

// Creates or refreshes the pin. Returns the URL to open for installing.
export async function createPin(appInfo, html) {
  const id = appInfo.id;
  const base = pinUrl(id);
  const data = await pack(html);
  const startUrl = data.length < 60000 ? `./#app=${data}` : "./";
  const manifest = {
    id: `pin-${id}`,
    name: appInfo.name,
    short_name: appInfo.name.slice(0, 14),
    description: appInfo.description || `${appInfo.name}, made in Local LLM Bench Studio`,
    start_url: startUrl,
    scope: "./",
    display: "standalone",
    background_color: appInfo.color || "#2a78d6",
    theme_color: appInfo.color || "#2a78d6",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  const cache = await caches.open("pins");
  const put = async (name, body, type) => cache.put(base + name, new Response(body, { headers: { "content-type": type } }));
  await put("manifest.webmanifest", JSON.stringify(manifest), "application/manifest+json");
  await put("icon-180.png", await icon(180, appInfo, true), "image/png");
  await put("icon-192.png", await icon(192, appInfo), "image/png");
  await put("icon-512.png", await icon(512, appInfo), "image/png");
  await put("icon-maskable.png", await icon(512, appInfo, true), "image/png");
  await put("meta.json", JSON.stringify({ id, name: appInfo.name, pinnedAt: Date.now() }), "application/json");
  return base + startUrl.slice(2);
}

export async function isPinned(id) {
  return !!(await (await caches.open("pins")).match(pinUrl(id) + "meta.json"));
}

export async function removePin(id) {
  const cache = await caches.open("pins");
  for (const req of await cache.keys()) if (req.url.startsWith(pinUrl(id))) await cache.delete(req);
}

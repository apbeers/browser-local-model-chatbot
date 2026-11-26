// Runs a Studio app in a sandboxed iframe and answers its appkit requests.
//
// Security: the iframe has sandbox="allow-scripts ..." WITHOUT allow-same-origin,
// so the app gets an opaque origin: it can't read OPFS, localStorage, cookies,
// the service worker caches or the parent page. The only way out is
// postMessage to this bridge, which limits storage to apps-data/<appId>/.
import * as apps from "./apps.js";

const KIT_JS = new URL("./appkit/appkit.js", import.meta.url).href;
const KIT_CSS = new URL("./appkit/appkit.css", import.meta.url).href;
let kitPromise = null;
function kit() {
  if (!kitPromise) kitPromise = Promise.all([fetch(KIT_JS).then((r) => r.text()), fetch(KIT_CSS).then((r) => r.text())]);
  return kitPromise;
}

// Builds the iframe document: our head injection first, then the app's HTML.
export async function composeDocument(html, themeCss) {
  const [js, css] = await kit();
  const inject =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    `<style id="ak-theme">${themeCss}</style><style id="ak-base">${css}</style><script>${js.replace(/<\/script/gi, "<\\/script")}</script>`;
  let doc = html && html.trim() ? html : "<!doctype html><html><head></head><body></body></html>";
  if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head[^>]*>/i, (m) => m + inject);
  else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, (m) => m + "<head>" + inject + "</head>");
  else doc = "<head>" + inject + "</head>" + doc;
  if (!/^\s*<!doctype/i.test(doc)) doc = "<!doctype html>" + doc;
  return doc;
}

/**
 * Mount an app.
 * opts: {
 *   appId, html,
 *   llm,                 the engine (app.llm) for appkit.ai
 *   theme(): {mode, css} the current theme for the app
 *   ensureModel(): Promise<boolean>  called when the app asks the AI and no model is loaded
 *   tools: {list(): [...], call(name, args)}  optional
 *   onLog({level, text}), onNotify(text), onLoad()
 * }
 * Returns {iframe, load(html), setTheme(), destroy()}.
 */
export function mountApp(container, opts) {
  const iframe = document.createElement("iframe");
  iframe.className = "app-frame";
  iframe.title = "App";
  iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox");
  iframe.setAttribute("allow", "clipboard-write");
  container.append(iframe);
  let kv = null; // cached key/value object
  const id = opts.appId;

  const post = (msg) => iframe.contentWindow && iframe.contentWindow.postMessage({ ak: 1, ...msg }, "*");
  const sendTheme = () => post({ event: "theme", data: opts.theme() });

  const handlers = {
    async "storage.get"({ key }) {
      kv = kv || (await apps.kvGet(id));
      return kv[key];
    },
    async "storage.set"({ key, value }) {
      kv = kv || (await apps.kvGet(id));
      kv[String(key)] = value === undefined ? null : JSON.parse(JSON.stringify(value));
      await apps.kvSet(id, kv);
      return true;
    },
    async "storage.remove"({ key }) {
      kv = kv || (await apps.kvGet(id));
      delete kv[key];
      await apps.kvSet(id, kv);
      return true;
    },
    async "storage.keys"() {
      kv = kv || (await apps.kvGet(id));
      return Object.keys(kv);
    },
    "files.list": () => apps.fileList(id),
    "files.read": ({ name }) => apps.fileRead(id, name),
    "files.write": async ({ name, text }) => (await apps.fileWrite(id, name, text), true),
    "files.remove": async ({ name }) => (await apps.fileRemove(id, name), true),
    async "ai.status"() {
      const l = opts.llm;
      return { loaded: !!l.modelId, model: l.model ? l.model.label : null, busy: l.state === "generating" || l.state === "loading" };
    },
    async "ai.chat"({ messages, maxTokens, temperature, json }, reqId) {
      const l = opts.llm;
      if (l.state === "generating" || l.state === "loading") throw new Error("The model is busy. Try again in a moment.");
      if (!l.modelId && !(opts.ensureModel && (await opts.ensureModel()))) throw new Error("No model is loaded. Load one in the main app first.");
      if (!Array.isArray(messages)) throw new Error("messages must be an array of {role, content}");
      const request = {};
      if (maxTokens) request.max_tokens = Math.min(4096, Number(maxTokens));
      if (temperature != null) request.temperature = Number(temperature);
      if (json) request.response_format = { type: "json_object" };
      const { text } = await l.generate(
        messages.map((m) => ({ role: m.role, content: String(m.content) })),
        { kind: "app", meta: { appId: id }, request, onToken: (t) => post({ id: reqId, token: t }) },
      );
      return text;
    },
    async "tools.list"() {
      return opts.tools ? opts.tools.list() : [];
    },
    async "tools.call"({ name, args }) {
      if (!opts.tools) throw new Error("No tools are available to apps.");
      return opts.tools.call(name, args);
    },
    async notify({ text }) {
      if (opts.onNotify) opts.onNotify(text);
      return true;
    },
    async download({ filename, text, type }) {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.replace(/[\\/]/g, "_");
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    },
  };

  const onMessage = async (e) => {
    if (e.source !== iframe.contentWindow) return;
    const m = e.data;
    if (!m || m.ak !== 1) return;
    if (m.hello) {
      sendTheme();
      if (opts.onLoad) opts.onLoad();
      return;
    }
    if (m.log) {
      if (opts.onLog) opts.onLog(m.log);
      return;
    }
    const fn = handlers[m.method];
    if (!fn) return post({ id: m.id, error: `Unknown appkit method "${m.method}"` });
    try {
      post({ id: m.id, result: await fn(m.params || {}, m.id) });
    } catch (err) {
      post({ id: m.id, error: String(err && err.message ? err.message : err) });
    }
  };
  window.addEventListener("message", onMessage);
  // Light/dark or color changes in the host reach the app right away.
  window.addEventListener("app-theme-changed", sendTheme);

  async function load(html) {
    kv = null;
    iframe.srcdoc = await composeDocument(html, opts.theme().css);
  }
  if (opts.html != null) load(opts.html);

  return {
    iframe,
    load,
    setTheme: sendTheme,
    destroy() {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("app-theme-changed", sendTheme);
      iframe.remove();
    },
  };
}

// Syntax-checks the inline scripts of an app without running them.
// Returns {ok, errors: [string]}.
export function checkAppHtml(html) {
  const errors = [];
  if (!html || !/<(body|div|main|script|h1|canvas)/i.test(html)) errors.push("The file has no page content.");
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  doc.querySelectorAll("script").forEach((s, i) => {
    if (s.src) {
      errors.push(`Script ${i + 1} loads ${s.src}: apps can't load files from the internet. Put the code inline.`);
      return;
    }
    const code = s.textContent;
    if (s.type === "module") return; // checked at runtime (errors show in the console)
    try {
      // Parses only; never runs.
      new Function(code);
    } catch (e) {
      errors.push(`Script ${i + 1}: ${e.message}`);
    }
  });
  doc.querySelectorAll('link[rel="stylesheet"][href^="http"]').forEach((l) => errors.push(`Stylesheet ${l.href} can't load offline. Put the CSS in a <style> tag.`));
  if (/localStorage|sessionStorage|indexedDB/.test(html)) errors.push("Apps can't use localStorage/indexedDB (sandboxed). Use appkit.storage instead.");
  return { ok: errors.length === 0, errors };
}

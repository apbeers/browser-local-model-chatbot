// Tools the models can call. Works with any model: instead of model-specific
// function calling, the model picks ONE tool and ONE text input per step with
// output forced to valid JSON, we run it, and repeat (max 3), then the model
// answers with the results in front of it.
//
// Each tool takes a single text input, which small models handle reliably.
// "network" tools reach the internet and only use sources that allow browser
// requests (CORS): Wikipedia, Open-Meteo, Hacker News (Algolia), and any URL
// whose site allows it.
import { readJSON, writeJSON } from "./opfs.js";
import { searchChats } from "./chats.js";

const clip = (s, n = 1800) => (s.length > n ? s.slice(0, n) + "…" : s);
const TIMEOUT = 15000; // network tools give up after 15 s
async function getJSON(url) {
  const r = await fetch(url, { mode: "cors", signal: AbortSignal.timeout(TIMEOUT) });
  if (r.status === 429) throw new Error("the service is busy (too many requests); try again in a minute");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- calculator: a small safe expression parser (no eval) ----------
function calc(src) {
  const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  let i = 0;
  const fns = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp };
  const consts = { pi: Math.PI, e: Math.E };
  const peek = () => s[i];
  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") v = s[i++] === "+" ? v + term() : v - term();
    return v;
  }
  function term() {
    let v = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = s[i++];
      const r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function power() {
    const b = unary();
    if (peek() === "^") {
      i++;
      return Math.pow(b, power());
    }
    return b;
  }
  function unary() {
    if (peek() === "-") return i++, -unary();
    if (peek() === "+") return i++, unary();
    return atom();
  }
  function atom() {
    if (peek() === "(") {
      i++;
      const v = expr();
      if (s[i++] !== ")") throw new Error("missing )");
      return v;
    }
    const num = s.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i);
    if (num) {
      i += num[0].length;
      let v = parseFloat(num[0]);
      if (peek() === "%") {
        i++;
        v /= 100;
      }
      return v;
    }
    const id = s.slice(i).match(/^[a-z]+/i);
    if (id) {
      const name = id[0].toLowerCase();
      i += id[0].length;
      if (name in consts) return consts[name];
      if (name in fns) {
        if (peek() !== "(") throw new Error(`${name} needs ( )`);
        return fns[name](atom());
      }
      throw new Error(`unknown name "${name}"`);
    }
    throw new Error(`unexpected "${peek() || "end"}"`);
  }
  const v = expr();
  if (i < s.length) throw new Error(`unexpected "${s[i]}"`);
  return v;
}

// ---------- run JavaScript: a Worker inside a sandboxed frame ----------
// The frame has an opaque origin (no access to OPFS, storage or this page), and
// the code runs in a Worker started from that frame, so an endless loop can't
// freeze the app: the frame stops the Worker after 3 seconds.
function runJs(code) {
  return new Promise((resolve) => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts");
    f.style.display = "none";
    const done = (r) => {
      clearTimeout(t);
      window.removeEventListener("message", on);
      f.remove();
      resolve(r);
    };
    const on = (e) => e.source === f.contentWindow && e.data && e.data.runJs && done(e.data.result);
    const t = setTimeout(() => done("Stopped: took longer than 4 seconds."), 4000);
    window.addEventListener("message", on);
    const workerSrc = `
      const logs = [];
      console.log = (...a) => logs.push(a.map((x) => typeof x === "object" ? JSON.stringify(x) : String(x)).join(" "));
      (async () => {
        let out;
        try {
          const v = await (async () => {\n${code}\n})();
          out = (logs.length ? logs.join("\\n") + "\\n" : "") + (v === undefined ? "" : "Result: " + (typeof v === "object" ? JSON.stringify(v) : String(v)));
        } catch (e) { out = (logs.join("\\n") + "\\nError: " + e.message).trim(); }
        postMessage((out || "(no output)").slice(0, 4000));
      })();`;
    f.srcdoc = `<script>
      const send = (r) => parent.postMessage({ runJs: true, result: r }, "*");
      try {
        const w = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSrc).replace(/</g, "\\u003c")}], { type: "text/javascript" })));
        const timer = setTimeout(() => { w.terminate(); send("Stopped: took longer than 3 seconds."); }, 3000);
        w.onmessage = (e) => { clearTimeout(timer); w.terminate(); send(e.data); };
        w.onerror = (e) => { clearTimeout(timer); w.terminate(); send("Error: " + e.message); };
      } catch (e) { send("Error: " + e.message); }
    <\/script>`;
    document.body.append(f);
  });
}

// ---------- notes ----------
async function notes() {
  return (await readJSON("app/notes.json", [])) || [];
}

const WMO = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers", 81: "rain showers", 82: "violent rain showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail" };

export const TOOLS = [
  { name: "calculator", input: "a math expression, e.g. (12.5*4)+sqrt(16)", description: "exact arithmetic and math functions", network: false, private: false, run: async (x) => String(+calc(x).toPrecision(12)) },
  {
    name: "datetime",
    input: "leave empty",
    description: "the current date, time, weekday and time zone",
    network: false,
    private: false,
    run: async () => {
      const d = new Date();
      return `${d.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })} (ISO ${d.toISOString()}, time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
    },
  },
  { name: "run_js", input: "JavaScript code; use console.log or return a value", description: "run JavaScript for counting, data processing or checking code", network: false, private: false, run: runJs },
  {
    name: "search_chats",
    input: "words to search for",
    description: "search the user's earlier chats on this device",
    network: false,
    private: true,
    run: async (q) => {
      const r = await searchChats(q, { limit: 5 });
      return r.length ? r.map((x) => `"${x.chat.title}": ${x.hits.map((hh) => hh.snippet).join(" | ")}`).join("\n") : "No matching chats.";
    },
  },
  {
    name: "save_note",
    input: "the text to remember",
    description: "save a note for later",
    network: false,
    private: true,
    run: async (text) => {
      const n = await notes();
      n.push({ at: Date.now(), text });
      await writeJSON("app/notes.json", n.slice(-500));
      return "Saved.";
    },
  },
  {
    name: "read_notes",
    input: "leave empty",
    description: "read the user's saved notes",
    network: false,
    private: true,
    run: async () => {
      const n = await notes();
      return n.length ? n.slice(-20).map((x) => `- ${new Date(x.at).toLocaleDateString()}: ${x.text}`).join("\n") : "No notes saved.";
    },
  },
  {
    name: "wikipedia",
    input: "a topic or question, e.g. Eiffel Tower",
    description: "look up facts in Wikipedia",
    network: true,
    private: false,
    run: async (q) => {
      const s = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&origin=*&srsearch=${encodeURIComponent(q)}`);
      const hits = s.query.search;
      if (!hits.length) return "No Wikipedia article found.";
      const title = hits[0].title;
      const e = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`);
      const page = Object.values(e.query.pages)[0];
      const others = hits.slice(1).map((x) => x.title).join(", ");
      return `${page.title} (https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}):\n${clip(page.extract || "")}${others ? `\nOther articles: ${others}` : ""}`;
    },
  },
  {
    name: "weather",
    input: "a place name, e.g. Paris",
    description: "current weather and 3-day forecast",
    network: true,
    private: false,
    run: async (place) => {
      const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(place)}`);
      const loc = g.results && g.results[0];
      if (!loc) return `Couldn't find "${place}".`;
      const w = await getJSON(
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3`,
      );
      const c = w.current;
      const days = w.daily.time.map((d, k) => `${d}: ${WMO[w.daily.weather_code[k]] || "code " + w.daily.weather_code[k]}, ${w.daily.temperature_2m_min[k]}–${w.daily.temperature_2m_max[k]}°C`).join("\n");
      return `${loc.name}, ${loc.country}: now ${c.temperature_2m}°C, ${WMO[c.weather_code] || ""}, wind ${c.wind_speed_10m} km/h.\n${days}`;
    },
  },
  {
    name: "hacker_news",
    input: "a topic, or leave empty for the front page",
    description: "tech news headlines from Hacker News",
    network: true,
    private: false,
    run: async (q) => {
      const r = await getJSON(q.trim() ? `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=6&query=${encodeURIComponent(q)}` : "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=8");
      return r.hits.map((x) => `- ${x.title} (${x.points} points) ${x.url || "https://news.ycombinator.com/item?id=" + x.objectID}`).join("\n") || "Nothing found.";
    },
  },
  {
    name: "fetch_url",
    input: "a full https:// address",
    description: "read a web page or API (only sites that allow browser access)",
    network: true,
    private: false,
    run: async (url) => {
      if (!/^https?:\/\//i.test(url.trim())) return "Give a full address starting with https://";
      let r;
      try {
        r = await fetch(url.trim(), { mode: "cors", signal: AbortSignal.timeout(TIMEOUT) });
      } catch {
        return "That site doesn't allow reading from a browser app (CORS), or it's unreachable.";
      }
      const type = r.headers.get("content-type") || "";
      const body = await r.text();
      if (/json/.test(type)) return clip(body, 3000);
      if (/html/.test(type)) {
        const doc = new DOMParser().parseFromString(body, "text/html");
        doc.querySelectorAll("script,style,noscript,svg,nav,footer").forEach((n) => n.remove());
        return clip(`${doc.title}\n${doc.body ? doc.body.textContent.replace(/\s+/g, " ").trim() : ""}`, 3000);
      }
      return clip(body, 3000);
    },
  },
];

// mode: "off" | "offline" | "web". Returns the tools allowed in that mode.
export function available(mode, { includePrivate = true } = {}) {
  if (mode === "off") return [];
  return TOOLS.filter((t) => (mode === "web" || !t.network) && (includePrivate || !t.private));
}

export async function callTool(name, input, allowed = TOOLS) {
  const t = allowed.find((x) => x.name === name);
  if (!t) throw new Error(`Tool "${name}" isn't available`);
  if (t.network && navigator.onLine === false) return "You're offline, so this tool can't reach the internet.";
  try {
    return clip(String(await t.run(String(input || ""))), 4000);
  } catch (err) {
    return `The tool failed: ${err.message || err}`;
  }
}

/**
 * Lets the model call tools before answering.
 * history: chat messages; the last one is the user's question.
 * Returns {messages, calls}: messages to generate the final answer from (the
 * results are added to the last user message), and [{tool, input, result}].
 */
export async function runToolLoop(llm, history, { mode, onStep = () => {}, signal, maxCalls = 3 } = {}) {
  const tools = available(mode);
  const calls = [];
  if (!tools.length) return { messages: history, calls };
  const question = history[history.length - 1].content;
  const list = tools.map((t) => `- ${t.name}: ${t.description}. Input: ${t.input}.`).join("\n");
  const schema = {
    type: "object",
    properties: { tool: { type: "string", enum: ["none", ...tools.map((t) => t.name)] }, input: { type: "string" } },
    required: ["tool", "input"],
  };
  for (let k = 0; k < maxCalls; k++) {
    if (signal && signal.aborted) break;
    const done = calls.map((c) => `${c.tool}(${JSON.stringify(c.input)}) returned:\n${c.result}`).join("\n\n");
    const res = await llm.generate(
      [
        {
          role: "system",
          content:
            `You decide whether a tool is needed before answering. Tools:\n${list}\n\n` +
            `Reply with JSON {"tool": name, "input": text}. Use a tool for facts you don't know for sure, current information, ` +
            `exact math, or the user's own notes and chats. Use "none" when you can answer well already` +
            (calls.length ? " or when the results below are enough." : "."),
        },
        { role: "user", content: `Question: ${question}${done ? `\n\nTool results so far:\n${done}` : ""}` },
      ],
      { kind: "tool-decide", request: { temperature: 0, max_tokens: 120, response_format: { type: "json_object", schema: JSON.stringify(schema) } } },
    );
    let pick;
    try {
      pick = JSON.parse(res.text);
    } catch {
      break;
    }
    if (!pick || pick.tool === "none" || !tools.some((t) => t.name === pick.tool)) break;
    if (calls.some((c) => c.tool === pick.tool && c.input === pick.input)) break; // no repeats
    onStep({ tool: pick.tool, input: pick.input, status: "running" });
    const result = await callTool(pick.tool, pick.input, tools);
    calls.push({ tool: pick.tool, input: pick.input, result });
    onStep({ tool: pick.tool, input: pick.input, status: "done", result });
  }
  if (!calls.length) return { messages: history, calls };
  const info = calls.map((c) => `[${c.tool}: ${c.input}]\n${c.result}`).join("\n\n");
  const messages = history.slice(0, -1).concat({
    role: "user",
    content: `${question}\n\n---\nInformation from tools (use it in your answer; mention sources with links when there are any):\n${info}`,
  });
  return { messages, calls };
}

// For Studio apps: public tools only (no access to the user's chats or notes).
export function appTools(mode = "web") {
  const allowed = available(mode, { includePrivate: false });
  return {
    list: () => allowed.map((t) => ({ name: t.name, input: t.input, description: t.description, network: t.network })),
    call: (name, args) => callTool(name, typeof args === "string" ? args : args && (args.input ?? args.query ?? args.url ?? args.expression ?? args.place ?? args.code ?? Object.values(args)[0] ?? ""), allowed),
  };
}

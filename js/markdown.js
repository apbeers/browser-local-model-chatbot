// Minimal, safe Markdown -> HTML renderer (no dependencies).
// Supports: headings, paragraphs, bold/italic/strike, inline code, fenced code
// blocks, ordered/unordered (nested by indent) lists, blockquotes, tables,
// horizontal rules, links (http/https/mailto only) and <think> blocks.
// All text is HTML-escaped first; only tags we generate are emitted.

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(src) {
  // Pull out code spans first so their contents are untouched.
  const codes = [];
  let s = src.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const u = url.replace(/&amp;/g, "&");
    if (!/^(https?:|mailto:)/i.test(u)) return text;
    return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w_])_([^_\s][^_]*)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

function renderTable(rows) {
  const cells = (r) =>
    r
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const head = cells(rows[0]);
  const aligns = cells(rows[1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : ""));
  const al = (i) => (aligns[i] ? ` style="text-align:${aligns[i]}"` : "");
  let h = '<div class="md-table"><table><thead><tr>';
  head.forEach((c, i) => (h += `<th${al(i)}>${inline(c)}</th>`));
  h += "</tr></thead><tbody>";
  for (const r of rows.slice(2)) {
    h += "<tr>";
    cells(r).forEach((c, i) => (h += `<td${al(i)}>${inline(c)}</td>`));
    h += "</tr>";
  }
  return h + "</tbody></table></div>";
}

function renderList(lines) {
  // lines: [{indent, ordered, text, start}]
  let html = "";
  const stack = [];
  for (const l of lines) {
    while (stack.length && l.indent < stack[stack.length - 1].indent) {
      html += `</li></${stack.pop().tag}>`;
    }
    const top = stack[stack.length - 1];
    if (!top || l.indent > top.indent) {
      const tag = l.ordered ? "ol" : "ul";
      const start = l.ordered && l.start !== 1 ? ` start="${l.start}"` : "";
      html += `<${tag}${start}><li>`;
      stack.push({ indent: l.indent, tag });
    } else {
      html += "</li><li>";
    }
    html += inline(l.text);
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

function renderBlocks(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let out = "";
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out += `<p>${para.map(inline).join("<br>")}</p>`;
      para = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    // Fenced code
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/);
    if (fence) {
      flushPara();
      const marker = fence[1];
      const lang = fence[2] || "";
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) body.push(lines[i++]);
      i++; // closing fence (or end while streaming)
      out += `<div class="md-code"><div class="md-code-bar"><span>${esc(lang || "code")}</span><button type="button" class="md-copy" aria-label="Copy code">Copy</button></div><pre><code>${esc(body.join("\n"))}</code></pre></div>`;
      continue;
    }
    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const lvl = Math.min(6, h[1].length + 2); // keep headings modest in chat
      out += `<h${lvl}>${inline(h[2].replace(/\s#+\s*$/, ""))}</h${lvl}>`;
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      out += "<hr>";
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out += `<blockquote>${renderBlocks(q.join("\n"))}</blockquote>`;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flushPara();
      const rows = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      out += renderTable(rows);
      continue;
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m) {
          items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10) || 1, text: m[3] });
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += " " + lines[i].trim();
          i++;
        } else break;
      }
      out += renderList(items);
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return out;
}

export function renderMarkdown(src) {
  if (!src) return "";
  // Reasoning blocks (<think>…</think>) render as a collapsible section.
  let html = "";
  const re = /<think>([\s\S]*?)(<\/think>|$)/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    html += renderBlocks(src.slice(last, m.index));
    const open = m[2] ? "" : " open";
    html += `<details class="md-think"${open}><summary>Thinking</summary>${renderBlocks(m[1])}</details>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) break;
  }
  html += renderBlocks(src.slice(last));
  return html;
}

// Delegated handler for "Copy" buttons in rendered code blocks.
export function installCopyHandler(root) {
  root.addEventListener("click", async (e) => {
    const btn = e.target.closest(".md-copy");
    if (!btn) return;
    const code = btn.closest(".md-code").querySelector("code").textContent;
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Failed";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1200);
  });
}
